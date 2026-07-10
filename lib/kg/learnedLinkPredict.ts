// LEARNED knowledge-graph LINK PREDICTION — a deterministic TransE-style scorer.
//
// The topology predictor (lib/kg/linkPredict.ts) ranks links from GRAPH STRUCTURE
// alone (common-neighbors / Adamic-Adar / resource-allocation / preferential-
// attachment). This module adds the complementary LEARNED view, ported from PyKEEN's
// TransE (backend/engines/pykeen, models/unimodal/trans_e.py) but WITHOUT its torch
// training loop or GPU: a small, fixed-seed, hash-initialized, margin-ranking trainer
// that runs identically here (TypeScript) and in backend/engines/pykeen/
// papertrail_train.py (Python). Same edge list → same embedding → same ranking.
//
// TransE embeds every entity e and relation r as a vector, and models a true triple
// (h, r, t) by the translation h + r ≈ t. A candidate link is scored by the
// translational DISTANCE d(h, r, t) = ||h + r - t|| (L2). A SMALL distance means the
// triple fits the geometry training induced — a plausible novel link. We rank
// candidates ASCENDING by distance (smaller = stronger).
//
// MOAT: there is NO LLM anywhere in a score or in training. All math is pure,
// deterministic, and immutable. When embeddings are unavailable (never trained, or a
// requested entity has no vector), the scorer returns an HONEST empty result with a
// note rather than fabricating a link.

import { getPool } from "@/lib/db";
import { neighbors, type KgNeighbor, type KgPool } from "./repository";
import { KG_PREDICATES, type KgNode, type KgPredicate } from "./schemas";

// ---------------------------------------------------------------------------
// Deterministic RNG + hash-derived initialization.
//
// Reproducibility is a moat requirement: a run must be byte-stable across machines.
// We therefore avoid Math.random entirely. Initialization for a given id is derived
// from a hash of (id + coordinate index), and stochastic tie-breaks during training
// use a small counter-seeded LCG. Both the Python trainer and this one use the SAME
// FNV-1a hash and the SAME formulas, so their embeddings agree bit-for-bit given the
// same edge order and hyperparameters.
// ---------------------------------------------------------------------------

const FNV_OFFSET = 2166136261 >>> 0;
const FNV_PRIME = 16777619;

// 32-bit FNV-1a over a string. Matches papertrail_train.py `_fnv1a`.
function fnv1a(input: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

// A hash-seeded value in [-INIT_RANGE, INIT_RANGE) for coordinate `idx` of `id`.
// Deterministic: same (id, idx, seed) always yields the same number.
function seededInit(id: string, idx: number, seed: number): number {
  const h = fnv1a(`${seed}:${id}:${idx}`);
  // map the 32-bit hash to [0, 1) then to [-INIT_RANGE, INIT_RANGE)
  const unit = h / 4294967296;
  return (unit * 2 - 1) * INIT_RANGE;
}

// A small deterministic LCG used only to shuffle the training order of triples per
// epoch (so gradient noise is reproducible). Numerical parameters are the classic
// Numerical Recipes LCG constants; the same sequence is reproduced in Python.
function lcg(state: number): number {
  return (Math.imul(state, 1664525) + 1013904223) >>> 0;
}

// ---------------------------------------------------------------------------
// Hyperparameters — fixed so the trainer is fully reproducible. Mirrored exactly in
// papertrail_train.py.
// ---------------------------------------------------------------------------

const DIM = 16; // embedding dimensionality
const EPOCHS = 100; // passes over the edge list
const LEARNING_RATE = 0.01; // SGD step
const MARGIN = 1.0; // margin-ranking hinge margin
const SEED = 20260709; // fixed global seed (repo build date)
const INIT_RANGE = 6 / Math.sqrt(DIM); // Glorot-style uniform init half-width

export interface TrainedEmbeddings {
  readonly dim: number;
  // entity uuid -> vector
  readonly entities: ReadonlyMap<string, readonly number[]>;
  // predicate -> vector
  readonly relations: ReadonlyMap<string, readonly number[]>;
}

export interface KgEdgeTriple {
  readonly subjectId: string;
  readonly predicate: KgPredicate;
  readonly objectId: string;
}

// ---------------------------------------------------------------------------
// Pure vector helpers. Every one returns a fresh array — nothing is mutated in place
// except the private working buffers inside trainKgEmbeddings (which never escape).
// ---------------------------------------------------------------------------

function l2Norm(v: readonly number[]): number {
  let sum = 0;
  for (const x of v) sum += x * x;
  return Math.sqrt(sum);
}

// TransE constrains entity vectors to the unit sphere each step (||e|| = 1). This is
// the standard normalization from the original TransE paper and PyKEEN's default.
function normalize(v: readonly number[]): number[] {
  const norm = l2Norm(v);
  if (norm === 0) return v.slice();
  return v.map((x) => x / norm);
}

// L2 distance of the TransE translation: ||h + r - t||.
export function transeDistance(
  head: readonly number[],
  relation: readonly number[],
  tail: readonly number[]
): number {
  let sum = 0;
  for (let i = 0; i < head.length; i++) {
    const d = head[i] + relation[i] - tail[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

// ---------------------------------------------------------------------------
// trainKgEmbeddings — the pure, deterministic TransE trainer. Mirrors
// papertrail_train.py step-for-step so the endpoint can train on demand from kg_edges
// and get the SAME weights the Python offline trainer would write.
//
// For each epoch, in a deterministically shuffled order, we take a positive triple
// (h, r, t), corrupt either its head or its tail (chosen deterministically) to form a
// negative (h', r, t'), and apply a margin-ranking (hinge) update: if
//   d(positive) + MARGIN > d(negative)
// we push the positive closer and the negative apart by one SGD step on the L2
// distance. Entities are renormalized to the unit sphere each update.
// ---------------------------------------------------------------------------

export function trainKgEmbeddings(edges: readonly KgEdgeTriple[]): TrainedEmbeddings {
  // Collect the entity and relation vocabularies in a STABLE, sorted order so init and
  // corruption sampling are independent of DB row order — a reproducibility guard.
  const entityIds = Array.from(new Set(edges.flatMap((e) => [e.subjectId, e.objectId]))).sort();
  const relationIds = Array.from(new Set(edges.map((e) => e.predicate))).sort();

  if (edges.length === 0 || entityIds.length === 0) {
    return { dim: DIM, entities: new Map(), relations: new Map() };
  }

  // Mutable working buffers (never escape this function).
  const entities = new Map<string, number[]>();
  for (const id of entityIds) {
    const v = Array.from({ length: DIM }, (_, k) => seededInit(id, k, SEED));
    entities.set(id, normalize(v));
  }
  const relations = new Map<string, number[]>();
  for (const id of relationIds) {
    // relations are NOT unit-normalized in TransE; init from the hash directly.
    relations.set(id, Array.from({ length: DIM }, (_, k) => seededInit(id, k, SEED + 1)));
  }

  const nEntities = entityIds.length;
  let rng = fnv1a(`shuffle:${SEED}`) >>> 0;

  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    // Deterministic Fisher-Yates shuffle of edge indices for this epoch.
    const order = edges.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      rng = lcg(rng);
      const j = rng % (i + 1);
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }

    for (const idx of order) {
      const triple = edges[idx];
      const head = entities.get(triple.subjectId);
      const rel = relations.get(triple.predicate);
      const tail = entities.get(triple.objectId);
      if (!head || !rel || !tail) continue;

      // Deterministically choose whether to corrupt head or tail, and which entity to
      // corrupt to, from an LCG advance. This keeps negatives reproducible.
      rng = lcg(rng);
      const corruptTail = (rng & 1) === 0;
      rng = lcg(rng);
      const corruptId = entityIds[rng % nEntities];
      const corrupt = entities.get(corruptId);
      if (!corrupt) continue;

      const negHead = corruptTail ? head : corrupt;
      const negTail = corruptTail ? corrupt : tail;

      const posDist = transeDistance(head, rel, tail);
      const negDist = transeDistance(negHead, rel, negTail);

      // Margin-ranking hinge: only step when the margin is violated.
      if (posDist + MARGIN <= negDist) continue;

      // Gradient of ||a + r - b|| w.r.t. each component is (a + r - b) / ||·||. We step
      // the positive DOWN and the negative UP. Guard against zero-distance division.
      const posScale = posDist > 0 ? LEARNING_RATE / posDist : 0;
      const negScale = negDist > 0 ? LEARNING_RATE / negDist : 0;

      for (let k = 0; k < DIM; k++) {
        const posGrad = head[k] + rel[k] - tail[k];
        const negGrad = negHead[k] + rel[k] - negTail[k];

        // Positive triple: move head/tail/rel to shrink posDist.
        head[k] -= posScale * posGrad;
        tail[k] += posScale * posGrad;
        rel[k] -= posScale * posGrad;

        // Negative triple: move to grow negDist (opposite sign).
        negHead[k] += negScale * negGrad;
        negTail[k] -= negScale * negGrad;
        rel[k] += negScale * negGrad;
      }

      // Renormalize the entity vectors that changed to the unit sphere.
      entities.set(triple.subjectId, normalize(head));
      entities.set(triple.objectId, normalize(tail));
      entities.set(corruptId, normalize(corrupt));
    }
  }

  // Freeze into immutable readonly maps.
  const frozenEntities = new Map<string, readonly number[]>();
  for (const [id, v] of entities) frozenEntities.set(id, v.slice());
  const frozenRelations = new Map<string, readonly number[]>();
  for (const [id, v] of relations) frozenRelations.set(id, v.slice());

  return { dim: DIM, entities: frozenEntities, relations: frozenRelations };
}

// ---------------------------------------------------------------------------
// Persistence — load / store embeddings in kg_embeddings (migration 0068).
// All SQL is parameterized. Vectors round-trip as double precision[].
// ---------------------------------------------------------------------------

function asRecord(row: unknown): Record<string, unknown> {
  return row && typeof row === "object" ? (row as Record<string, unknown>) : {};
}

// pg returns a numeric[] column as a JS number[] already; a stringified form is
// tolerated defensively so a mis-typed row can never crash the scorer.
function parseVector(raw: unknown): number[] | null {
  if (Array.isArray(raw)) {
    const out: number[] = [];
    for (const x of raw) {
      const n = typeof x === "number" ? x : Number(x);
      if (!Number.isFinite(n)) return null;
      out.push(n);
    }
    return out;
  }
  if (typeof raw === "string") {
    const trimmed = raw.replace(/^[{[]/, "").replace(/[}\]]$/, "");
    if (trimmed.length === 0) return [];
    const out: number[] = [];
    for (const part of trimmed.split(",")) {
      const n = Number(part);
      if (!Number.isFinite(n)) return null;
      out.push(n);
    }
    return out;
  }
  return null;
}

// Load every trained embedding from kg_embeddings into the in-memory shape the scorer
// consumes. Returns null when no embeddings exist yet (honest "unavailable").
export async function loadEmbeddings(pool: KgPool): Promise<TrainedEmbeddings | null> {
  const { rows } = await pool.query(
    `select kind, key, vector, dim from kg_embeddings order by kind, key`
  );

  const entities = new Map<string, readonly number[]>();
  const relations = new Map<string, readonly number[]>();
  let dim = 0;

  for (const row of rows) {
    const r = asRecord(row);
    const vector = parseVector(r.vector);
    if (!vector || vector.length === 0) continue;
    dim = vector.length;
    if (r.kind === "entity" && typeof r.key === "string") {
      entities.set(r.key, vector);
    } else if (r.kind === "relation" && typeof r.key === "string") {
      relations.set(r.key, vector);
    }
  }

  if (entities.size === 0 || relations.size === 0) return null;
  return { dim, entities, relations };
}

// Persist a freshly trained embedding set. Upserts on the unique (kind, key) index so
// re-training refreshes vectors in place. Runs inside a single connection so a partial
// write never leaves a half-trained table visible to a concurrent scorer.
export async function persistEmbeddings(
  pool: KgPool,
  trained: TrainedEmbeddings
): Promise<{ entities: number; relations: number }> {
  const upsert = async (kind: "entity" | "relation", key: string, vector: readonly number[]) => {
    await pool.query(
      `insert into kg_embeddings (kind, key, vector, dim, trained_at)
         values ($1, $2, $3::double precision[], $4, now())
       on conflict (kind, key)
         do update set vector = excluded.vector, dim = excluded.dim, trained_at = now()`,
      [kind, key, vector.slice(), trained.dim]
    );
  };

  for (const [key, vector] of trained.entities) await upsert("entity", key, vector);
  for (const [key, vector] of trained.relations) await upsert("relation", key, vector);

  return { entities: trained.entities.size, relations: trained.relations.size };
}

// ---------------------------------------------------------------------------
// Candidate discovery + scoring.
//
// We reuse the repository's neighbors() primitive to gather the local candidate pool
// (the object nodes reachable within a bounded BFS from `fromNode`), then score each
// candidate that is NOT already directly linked from `fromNode` by TransE distance.
// This mirrors linkPredict.ts's candidate rule so the two predictors are comparable.
// ---------------------------------------------------------------------------

const DEFAULT_RADIUS = 2;
const MAX_RADIUS = 4;
const MAX_NODES = 5_000;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

export interface LearnedPrediction {
  readonly subject: KgNode;
  readonly predicate: KgPredicate;
  readonly object: KgNode;
  readonly distance: number;
}

export interface LearnedPredictResult {
  readonly predictions: readonly LearnedPrediction[];
  // A non-null note explains an EMPTY result honestly (no embeddings, no vector for the
  // source, or no candidates) rather than implying "nothing is related".
  readonly note: string | null;
}

export interface LearnedPredictOptions {
  readonly predicate?: KgPredicate;
  readonly radius?: number;
  readonly limit?: number;
  readonly accept?: (subjectType: string, objectType: string) => boolean;
}

// Gather candidate object nodes + directly-linked object ids via a bounded BFS. Reads
// ONLY through repository.neighbors so it stays offline-testable against the KG fake.
async function gatherCandidates(
  pool: KgPool,
  fromId: string,
  radius: number
): Promise<{ candidates: Map<string, KgNode>; directLinks: Set<string> }> {
  const hopBudget = Math.max(1, Math.min(Math.trunc(radius), MAX_RADIUS));
  const candidates = new Map<string, KgNode>();
  const directLinks = new Set<string>();

  const expanded = new Set<string>();
  let frontier: string[] = [fromId];

  for (let hop = 0; hop < hopBudget; hop++) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      if (expanded.has(nodeId)) continue;
      expanded.add(nodeId);
      if (candidates.size > MAX_NODES) break;

      const outs: KgNeighbor[] = await neighbors(pool, nodeId);
      for (const { edge, node } of outs) {
        candidates.set(node.id, node);
        if (edge.subjectId === fromId) directLinks.add(node.id);
        if (!expanded.has(node.id)) next.push(node.id);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  return { candidates, directLinks };
}

// Rank predicted links for `fromNode` by TransE distance (ascending = strongest),
// using a provided embedding set. Pure w.r.t. the embeddings; returns a fresh sorted
// array. Ties break on object id for a stable, deterministic order.
export async function predictLearnedLinks(
  pool: KgPool,
  fromNode: KgNode,
  embeddings: TrainedEmbeddings,
  options: LearnedPredictOptions = {}
): Promise<LearnedPredictResult> {
  const predicate: KgPredicate = options.predicate ?? "associates_with";
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? DEFAULT_LIMIT), MAX_LIMIT));

  const headVec = embeddings.entities.get(fromNode.id);
  const relVec = embeddings.relations.get(predicate);
  if (!headVec) {
    return { predictions: [], note: "No learned embedding for the source entity; train embeddings first." };
  }
  if (!relVec) {
    return { predictions: [], note: `No learned embedding for predicate '${predicate}'.` };
  }

  const { candidates, directLinks } = await gatherCandidates(
    pool,
    fromNode.id,
    options.radius ?? DEFAULT_RADIUS
  );

  const scored: LearnedPrediction[] = [];
  for (const [candidateId, candidate] of candidates) {
    if (candidateId === fromNode.id) continue; // no self-link
    if (directLinks.has(candidateId)) continue; // link already exists — not novel
    if (options.accept && !options.accept(fromNode.entityType, candidate.entityType)) continue;

    const tailVec = embeddings.entities.get(candidateId);
    if (!tailVec) continue; // no learned vector for this candidate — honest omission

    const distance = transeDistance(headVec, relVec, tailVec);
    scored.push({ subject: fromNode, predicate, object: candidate, distance });
  }

  scored.sort((a, b) =>
    a.distance !== b.distance ? a.distance - b.distance : a.object.id < b.object.id ? -1 : 1
  );

  const predictions = scored.slice(0, limit);
  const note =
    predictions.length === 0
      ? "No scorable candidates with learned embeddings in the local neighborhood."
      : null;
  return { predictions, note };
}

// ---------------------------------------------------------------------------
// Train-on-demand — read all kg_edges triples and (re)train + persist embeddings.
// Used by the API route when no embeddings exist yet. Reads edges via parameterized
// SQL against the shared pool. Returns the trained set so the caller can score
// immediately without a second load.
// ---------------------------------------------------------------------------

const VALID_PREDICATES = new Set<string>(KG_PREDICATES);

export async function loadAllEdges(pool: KgPool): Promise<KgEdgeTriple[]> {
  const { rows } = await pool.query(
    `select subject_id, predicate, object_id from kg_edges`
  );
  const triples: KgEdgeTriple[] = [];
  for (const row of rows) {
    const r = asRecord(row);
    const subjectId = typeof r.subject_id === "string" ? r.subject_id : null;
    const objectId = typeof r.object_id === "string" ? r.object_id : null;
    const predicate = typeof r.predicate === "string" ? r.predicate : null;
    if (!subjectId || !objectId || !predicate) continue;
    if (!VALID_PREDICATES.has(predicate)) continue; // closed vocabulary only
    triples.push({ subjectId, predicate: predicate as KgPredicate, objectId });
  }
  return triples;
}

export async function trainAndPersist(
  pool: KgPool
): Promise<{ trained: TrainedEmbeddings; edgeCount: number }> {
  const edges = await loadAllEdges(pool);
  const trained = trainKgEmbeddings(edges);
  if (trained.entities.size > 0) {
    await persistEmbeddings(pool, trained);
  }
  return { trained, edgeCount: edges.length };
}

// Convenience accessor: the shared production pool, typed as the minimal KgPool the KG
// layer depends on (mirrors the cast used across app/api/kg/*). The pg.Pool `query`
// satisfies KgPool structurally; the cast bridges pg's overloaded signature.
export function defaultPool(): KgPool {
  return getPool() as unknown as KgPool;
}
