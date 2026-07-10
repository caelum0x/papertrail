// Hybrid retrieval — a NATIVE TypeScript port of R2R's `hybrid_search`
// (backend/engines/R2R/py/core/providers/database/chunks.py::hybrid_search).
//
// R2R combines three independently-ranked signals over its chunk store:
//   1. SEMANTIC   — pgvector cosine similarity (dense retrieval)
//   2. FULL-TEXT  — Postgres tsvector/websearch_to_tsquery keyword rank (sparse)
//   3. GRAPH      — knowledge-graph neighbor expansion of the top hits
// and fuses (1) and (2) with Reciprocal Rank Fusion (RRF). This module ports that
// same shape over OUR cached `sources` table: it reuses the existing pgvector SQL
// pattern from lib/agents/retrievalAgent, adds a Postgres full-text/ILIKE keyword
// query, fuses the two rankings with the identical RRF math R2R uses, and optionally
// expands the fused set via kg neighbors of the matched sources.
//
// The fusion math (fuseRankings) is PURE and DETERMINISTIC — it takes two ranked id
// lists and returns fused scores independent of any I/O. That is what the tests pin
// against hand-computed values. The pool and embedder are INJECTABLE so the fusion
// and expansion logic can be exercised fully offline.

import { getPool } from "../db";
import { embed, toPgVectorLiteral } from "../embeddings";

// ---------------------------------------------------------------------------
// RRF constants — kept identical to R2R's HybridSearchSettings defaults so the
// fusion behaves the way the source algorithm was tuned for.
//
// - RRF_K: the rank-fusion smoothing constant. Each list contributes
//   1 / (RRF_K + rank); a larger k flattens the contribution of top ranks,
//   preventing a single #1 hit from dominating the fused score. R2R defaults to 50.
// - SEMANTIC_WEIGHT / FULL_TEXT_WEIGHT: relative trust in the dense vs. sparse
//   signal. R2R defaults to 5.0 / 1.0 — semantic is weighted more heavily, but a
//   strong keyword match still lifts a result.
// ---------------------------------------------------------------------------
export const RRF_K = 50;
export const SEMANTIC_WEIGHT = 5.0;
export const FULL_TEXT_WEIGHT = 1.0;

// Default fan-out for each individual ranker before fusion. Mirrors R2R's split of
// `limit` (semantic) vs. `full_text_limit` (keyword); full-text pulls a wider net so
// exact-term matches outside the dense neighborhood still get a chance to fuse in.
export const DEFAULT_SEMANTIC_LIMIT = 10;
export const DEFAULT_FULL_TEXT_LIMIT = 20;
export const DEFAULT_FINAL_LIMIT = 10;

// Columns projected for every hit — kept in sync with retrievalAgent's SOURCE_COLUMNS
// so a hybrid hit is shape-compatible with a normal retrieval SourceCandidate.
const SOURCE_COLUMNS =
  "id, source_type, external_id, title, raw_text, url, phase, enrollment_count, registered_results";

// A single ranked source coming out of one ranker (semantic OR keyword). `rankScore`
// is the ranker's own score (cosine similarity or ts_rank), retained for display.
export interface RankedSource {
  id: string;
  source_type: string;
  external_id: string;
  title: string | null;
  raw_text: string;
  url: string;
  phase: string | null;
  enrollment_count: number | null;
  registered_results: unknown[] | null;
  rankScore: number;
}

// A fused hit: the source data plus its fusion provenance (which ranks fed the RRF
// score, and whether it was pulled in by graph expansion rather than direct ranking).
export interface HybridHit extends RankedSource {
  rrfScore: number;
  semanticRank: number | null;
  fullTextRank: number | null;
  graphExpanded: boolean;
}

// The minimal Postgres surface this module needs — a single parameterized `query`.
// A real pg.Pool satisfies it directly; tests inject a tiny fake. Rows are untyped
// (unknown) and validated as they are mapped into RankedSource.
export interface HybridPool {
  query: (
    sql: string,
    params?: readonly unknown[]
  ) => Promise<{ rows: unknown[] }>;
}

// Injectable dependencies. Everything defaults to the real stack so callers pass
// nothing in production; tests override `pool` / `embed` for fully-offline runs.
export interface HybridDeps {
  pool?: HybridPool;
  embed?: (text: string) => Promise<number[]>;
  semanticLimit?: number;
  fullTextLimit?: number;
  finalLimit?: number;
  rrfK?: number;
  semanticWeight?: number;
  fullTextWeight?: number;
  // When true, expand the fused top hits by one hop of kg neighbors and fold any
  // neighbor sources into the result set (scored as graph-expanded, ranked last).
  expandGraph?: boolean;
}

// ---------------------------------------------------------------------------
// fuseRankings — PURE Reciprocal Rank Fusion, ported verbatim from R2R's
// hybrid_search fusion loop. Deterministic; no I/O.
//
// Inputs are two ranking lists as ordered arrays of ids (best first). For each id:
//   - semanticRank / fullTextRank are 1-indexed positions in their list.
//   - A doc absent from a list is assigned that list's LIMIT as its rank (R2R's
//     `full_text_limit` / `semantic_limit` fallback) — present-but-unranked, not
//     rank-1, so a one-list hit can't masquerade as a perfect dual match.
//   - Candidates are pruned to those whose semantic_rank ≤ semanticLimit*2 AND
//     full_text_rank ≤ fullTextLimit*2 (R2R's window filter).
//   - rrf = (w_s/(k+r_s) + w_f/(k+r_f)) / (w_s + w_f).
// Ties in rrf are broken by a stable secondary sort on id so ordering is
// deterministic across runs and platforms.
// ---------------------------------------------------------------------------
export interface FusionInput {
  semanticIds: readonly string[];
  fullTextIds: readonly string[];
  semanticLimit: number;
  fullTextLimit: number;
  rrfK?: number;
  semanticWeight?: number;
  fullTextWeight?: number;
}

export interface FusedRank {
  id: string;
  rrfScore: number;
  semanticRank: number | null; // null == not present in the semantic list
  fullTextRank: number | null; // null == not present in the keyword list
}

export function fuseRankings(input: FusionInput): FusedRank[] {
  const rrfK = input.rrfK ?? RRF_K;
  const semanticWeight = input.semanticWeight ?? SEMANTIC_WEIGHT;
  const fullTextWeight = input.fullTextWeight ?? FULL_TEXT_WEIGHT;
  const { semanticLimit, fullTextLimit } = input;

  // present rank (1-indexed) per list; absence tracked separately from the
  // fallback rank used in the score, so provenance stays honest.
  const semanticPos = new Map<string, number>();
  input.semanticIds.forEach((id, i) => {
    if (!semanticPos.has(id)) semanticPos.set(id, i + 1);
  });
  const fullTextPos = new Map<string, number>();
  input.fullTextIds.forEach((id, i) => {
    if (!fullTextPos.has(id)) fullTextPos.set(id, i + 1);
  });

  const allIds = new Set<string>([...semanticPos.keys(), ...fullTextPos.keys()]);

  const fused: FusedRank[] = [];
  for (const id of allIds) {
    const semPresent = semanticPos.get(id);
    const ftPresent = fullTextPos.get(id);

    // R2R fallback: a missing doc takes the OTHER list's limit as its rank.
    const semRankForScore = semPresent ?? semanticLimit;
    const ftRankForScore = ftPresent ?? fullTextLimit;

    // R2R window filter: drop candidates that sit deep in both tails.
    if (semRankForScore > semanticLimit * 2) continue;
    if (ftRankForScore > fullTextLimit * 2) continue;

    const semanticScore = 1 / (rrfK + semRankForScore);
    const fullTextScore = 1 / (rrfK + ftRankForScore);
    const rrfScore =
      (semanticScore * semanticWeight + fullTextScore * fullTextWeight) /
      (semanticWeight + fullTextWeight);

    fused.push({
      id,
      rrfScore,
      semanticRank: semPresent ?? null,
      fullTextRank: ftPresent ?? null,
    });
  }

  // Descending by fused score; stable tiebreak on id for deterministic ordering.
  return fused.sort((a, b) => {
    if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// Rankers over OUR `sources` table.
// ---------------------------------------------------------------------------

function rowToRanked(row: unknown, rankScore: number): RankedSource {
  const r = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
  return {
    id: String(r.id),
    source_type: String(r.source_type),
    external_id: String(r.external_id),
    title: r.title == null ? null : String(r.title),
    raw_text: String(r.raw_text ?? ""),
    url: String(r.url ?? ""),
    phase: r.phase == null ? null : String(r.phase),
    enrollment_count:
      r.enrollment_count == null ? null : Number(r.enrollment_count),
    registered_results: Array.isArray(r.registered_results)
      ? (r.registered_results as unknown[])
      : null,
    rankScore,
  };
}

// Dense retrieval: pgvector cosine similarity, mirroring retrievalAgent's SQL.
async function semanticRanker(
  pool: HybridPool,
  queryVector: number[],
  limit: number
): Promise<RankedSource[]> {
  const vectorLiteral = toPgVectorLiteral(queryVector);
  const { rows } = await pool.query(
    `select ${SOURCE_COLUMNS},
            1 - (embedding <=> $1::vector) as similarity
       from sources
      where embedding is not null
      order by embedding <=> $1::vector
      limit $2`,
    [vectorLiteral, limit]
  );
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    return rowToRanked(row, Number(r.similarity ?? 0));
  });
}

// Sparse retrieval: Postgres full-text rank. R2R uses a persisted `fts` tsvector
// column; OUR sources table has no such column, so we compute the tsvector inline
// from title+raw_text with to_tsvector, ranked by ts_rank against a
// websearch_to_tsquery — the exact query family R2R uses. A COALESCE-guarded ILIKE
// on the raw query string is OR'd in as a fallback so a short/stopword query that
// yields an empty tsquery still surfaces literal substring matches.
async function keywordRanker(
  pool: HybridPool,
  queryText: string,
  limit: number
): Promise<RankedSource[]> {
  const ilike = `%${queryText.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const { rows } = await pool.query(
    `select ${SOURCE_COLUMNS},
            ts_rank(
              to_tsvector('english', coalesce(title, '') || ' ' || raw_text),
              websearch_to_tsquery('english', $1),
              32
            ) as rank
       from sources
      where to_tsvector('english', coalesce(title, '') || ' ' || raw_text)
              @@ websearch_to_tsquery('english', $1)
         or (coalesce(title, '') || ' ' || raw_text) ilike $2 escape '\\'
      order by rank desc
      limit $3`,
    [queryText, ilike, limit]
  );
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    return rowToRanked(row, Number(r.rank ?? 0));
  });
}

// Graph expansion: for the fused top sources, pull their kg node's outbound
// neighbors and map any neighbor whose provenance cites another source back to a
// `sources` row. This is R2R's graph-search leg — it surfaces sources connected in
// the knowledge graph even when they never ranked in either text/vector list.
//
// Kept dependency-light and defensive: if the kg tables or a source link are
// missing, expansion simply yields nothing rather than failing the whole search.
async function graphExpand(
  pool: HybridPool,
  seedSourceIds: readonly string[],
  limit: number
): Promise<RankedSource[]> {
  if (seedSourceIds.length === 0 || limit <= 0) return [];
  try {
    // Neighbor sources: sources whose id appears as the object of a kg_edge whose
    // subject is a kg_node cited (in provenance) by one of the seed sources. We keep
    // this to a single parameterized query over the existing kg schema.
    const { rows } = await pool.query(
      `select distinct ${SOURCE_COLUMNS}
         from sources s
         join kg_edges e
           on (e.provenance->>'source_id') = s.external_id
        where e.subject_id in (
                select e2.object_id
                  from kg_edges e2
                 where (e2.provenance->>'source_id') = any($1::text[])
              )
          and s.external_id <> all($1::text[])
        limit $2`,
      [seedSourceIds, limit]
    );
    return rows.map((row) => rowToRanked(row, 0));
  } catch {
    // KG is optional context — never let its absence sink the hybrid search.
    return [];
  }
}

// ---------------------------------------------------------------------------
// hybridSearch — the public entry point. Runs the two rankers over OUR sources,
// fuses them with RRF, optionally folds in graph-expanded neighbors, and returns
// the fused top hits (best first) as HybridHit rows.
// ---------------------------------------------------------------------------
export async function hybridSearch(
  query: string,
  deps: HybridDeps = {}
): Promise<HybridHit[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new Error("hybridSearch: query must be a non-empty string");
  }

  const pool = deps.pool ?? (getPool() as unknown as HybridPool);
  const embedFn = deps.embed ?? embed;
  const semanticLimit = deps.semanticLimit ?? DEFAULT_SEMANTIC_LIMIT;
  const fullTextLimit = deps.fullTextLimit ?? DEFAULT_FULL_TEXT_LIMIT;
  const finalLimit = deps.finalLimit ?? DEFAULT_FINAL_LIMIT;

  const queryVector = await embedFn(trimmed);

  // Run both rankers concurrently — they hit the same table but are independent.
  const [semanticResults, keywordResults] = await Promise.all([
    semanticRanker(pool, queryVector, semanticLimit),
    keywordRanker(pool, trimmed, fullTextLimit),
  ]);

  // Source data lookup keyed by id, so the pure fusion can stay id-only.
  const byId = new Map<string, RankedSource>();
  for (const r of semanticResults) byId.set(r.id, r);
  for (const r of keywordResults) if (!byId.has(r.id)) byId.set(r.id, r);

  const fused = fuseRankings({
    semanticIds: semanticResults.map((r) => r.id),
    fullTextIds: keywordResults.map((r) => r.id),
    semanticLimit,
    fullTextLimit,
    rrfK: deps.rrfK,
    semanticWeight: deps.semanticWeight,
    fullTextWeight: deps.fullTextWeight,
  });

  const hits: HybridHit[] = fused
    .map((f): HybridHit | null => {
      const source = byId.get(f.id);
      if (!source) return null;
      return {
        ...source,
        rrfScore: f.rrfScore,
        semanticRank: f.semanticRank,
        fullTextRank: f.fullTextRank,
        graphExpanded: false,
      };
    })
    .filter((h): h is HybridHit => h !== null);

  const topHits = hits.slice(0, finalLimit);

  if (!deps.expandGraph) {
    return topHits;
  }

  // Graph leg: expand from the external_ids of the fused top hits, appended after
  // the RRF-ranked results and de-duplicated against them.
  const seedExternalIds = topHits.map((h) => h.external_id);
  const seen = new Set(topHits.map((h) => h.id));
  const neighbors = await graphExpand(
    pool,
    seedExternalIds,
    Math.max(0, finalLimit - topHits.length) + finalLimit
  );

  const expanded: HybridHit[] = [];
  for (const n of neighbors) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    expanded.push({
      ...n,
      rrfScore: 0,
      semanticRank: null,
      fullTextRank: null,
      graphExpanded: true,
    });
  }

  return [...topHits, ...expanded].slice(0, finalLimit);
}

// ===========================================================================
// RAG-FUSION (biomedical query expansion) — ADDITIVE layer over hybridSearch.
//
// A NATIVE TypeScript mirror of backend/engines/R2R/r2r/papertrail_rag_fusion.py.
// Where hybridSearch fuses two RANKERS (dense + sparse) over ONE query, RAG-Fusion
// decomposes a query into several biomedical sub-queries (efficacy / safety /
// mechanism / subgroup), runs the EXISTING hybridSearch per facet, and fuses the
// several result LISTS with the same Reciprocal Rank Fusion arithmetic.
//
// The decomposition is a fixed, auditable TEMPLATE — NOT an LLM generation step —
// so it is fully deterministic (same query -> same facets, always). The fusion
// (fuseFacetRankings) is PURE and DETERMINISTIC. This block adds new exports ONLY;
// it does not change hybridSearch, fuseRankings, or any existing export.
// ===========================================================================

// The four biomedical facets every claim is decomposed into. Fixed + auditable,
// mirroring FACETS in papertrail_rag_fusion.py. Each facet is a clinical lens on
// the SAME underlying claim, not a different question.
export const RAG_FUSION_FACETS = [
  "efficacy",
  "safety",
  "mechanism",
  "subgroup",
] as const;
export type RagFusionFacet = (typeof RAG_FUSION_FACETS)[number];

// Per-facet cue terms appended to the base query to steer that facet's retrieval.
// Kept in sync with _FACET_CUES in papertrail_rag_fusion.py.
export const FACET_CUES: Readonly<Record<RagFusionFacet, readonly string[]>> = {
  efficacy: [
    "efficacy",
    "effect size",
    "risk reduction",
    "hazard ratio",
    "primary endpoint",
    "relative risk",
  ],
  safety: [
    "safety",
    "adverse events",
    "harms",
    "tolerability",
    "toxicity",
    "serious adverse",
  ],
  mechanism: [
    "mechanism of action",
    "pathway",
    "target",
    "pharmacology",
    "biological mechanism",
  ],
  subgroup: [
    "subgroup",
    "population",
    "elderly",
    "age",
    "sex",
    "comorbidity",
    "stratified analysis",
  ],
};

// One facet's deterministic sub-query over the original claim.
export interface FacetQuery {
  facet: RagFusionFacet;
  query: string;
  cues: readonly string[];
}

// A source that survived RAG-Fusion: the full source data, its fused RRF score,
// and which facets ranked it (and at what 1-indexed rank) — the fusion provenance.
export interface RagFusionHit extends RankedSource {
  rrfScore: number;
  facetRanks: Partial<Record<RagFusionFacet, number>>;
}

// ---------------------------------------------------------------------------
// decomposeIntoFacets — DETERMINISTIC template decomposition. Preserves the base
// query verbatim (so a ranker still matches the specifics) and appends each
// facet's fixed cue terms. A blank query yields an empty list (honest, not four
// empty facets). Mirror of decompose() in papertrail_rag_fusion.py.
// ---------------------------------------------------------------------------
export function decomposeIntoFacets(query: string): FacetQuery[] {
  const base = query.trim();
  if (base.length === 0) return [];
  return RAG_FUSION_FACETS.map((facet) => {
    const cues = FACET_CUES[facet];
    return { facet, query: `${base} ${cues.join(" ")}`, cues };
  });
}

// ---------------------------------------------------------------------------
// fuseFacetRankings — PURE N-list Reciprocal Rank Fusion, generalizing R2R's
// 2-list hybrid fusion to one ranked list per facet. Deterministic; no I/O.
//
// For each document across all facet lists:
//   rrfScore = Σ_facets ( weight_f / (rrfK + rank_f) )
// where rank_f is the doc's 1-indexed position in facet f's list. A document
// absent from a facet simply contributes nothing for that facet — it is never
// penalized with a fabricated rank. Ties break stably on id for determinism.
// Mirror of reciprocal_rank_fusion() in papertrail_rag_fusion.py.
// ---------------------------------------------------------------------------
export interface RagFusionInput {
  facetLists: Partial<Record<RagFusionFacet, readonly string[]>>;
  rrfK?: number;
  facetWeights?: Partial<Record<RagFusionFacet, number>>;
}

export interface RagFusedRank {
  id: string;
  rrfScore: number;
  facetRanks: Partial<Record<RagFusionFacet, number>>;
}

export function fuseFacetRankings(input: RagFusionInput): RagFusedRank[] {
  const rrfK = input.rrfK ?? RRF_K;
  const scores = new Map<string, number>();
  const facetRanks = new Map<string, Partial<Record<RagFusionFacet, number>>>();

  for (const facet of RAG_FUSION_FACETS) {
    const ids = input.facetLists[facet];
    if (!ids) continue;
    const weight = input.facetWeights?.[facet] ?? 1.0;
    const seenInFacet = new Set<string>();
    ids.forEach((id, index) => {
      if (seenInFacet.has(id)) return; // first occurrence wins the rank
      seenInFacet.add(id);
      const rank = index + 1; // 1-indexed, matching R2R + the Python port
      scores.set(id, (scores.get(id) ?? 0) + weight / (rrfK + rank));
      const ranks = facetRanks.get(id) ?? {};
      ranks[facet] = rank;
      facetRanks.set(id, ranks);
    });
  }

  const fused: RagFusedRank[] = [];
  for (const [id, rrfScore] of scores) {
    fused.push({ id, rrfScore, facetRanks: facetRanks.get(id) ?? {} });
  }
  return fused.sort((a, b) => {
    if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// Injectable deps for ragFusionRetrieve. `hybrid` defaults to the real
// hybridSearch so production callers pass nothing; tests inject a stub that
// returns canned per-facet hits with no DB/embeddings.
export interface RagFusionDeps extends HybridDeps {
  // Per-facet retriever. Defaults to the existing hybridSearch export (unchanged).
  hybrid?: (query: string, deps: HybridDeps) => Promise<HybridHit[]>;
  // Cap on the fused result set (defaults to DEFAULT_FINAL_LIMIT).
  finalLimit?: number;
  facetWeights?: Partial<Record<RagFusionFacet, number>>;
}

// ---------------------------------------------------------------------------
// ragFusionRetrieve — the public RAG-Fusion entry point. Decomposes the query
// into biomedical facets, runs the EXISTING hybridSearch for each facet, fuses
// the per-facet rankings with RRF, and returns the fused top hits (best first)
// with per-facet provenance. Additive: reuses hybridSearch verbatim and never
// alters the tuned dense+sparse hybrid behavior.
// ---------------------------------------------------------------------------
export interface RagFusionResult {
  facets: FacetQuery[];
  hits: RagFusionHit[];
}

export async function ragFusionRetrieve(
  query: string,
  deps: RagFusionDeps = {}
): Promise<RagFusionResult> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new Error("ragFusionRetrieve: query must be a non-empty string");
  }

  const facets = decomposeIntoFacets(trimmed);
  const runHybrid = deps.hybrid ?? hybridSearch;
  const finalLimit = deps.finalLimit ?? DEFAULT_FINAL_LIMIT;

  // Only forward the HybridDeps subset to the per-facet retriever — the
  // RAG-Fusion-specific fields (hybrid, facetWeights, finalLimit) are consumed here.
  const hybridDeps: HybridDeps = {
    pool: deps.pool,
    embed: deps.embed,
    semanticLimit: deps.semanticLimit,
    fullTextLimit: deps.fullTextLimit,
    finalLimit: deps.finalLimit,
    rrfK: deps.rrfK,
    semanticWeight: deps.semanticWeight,
    fullTextWeight: deps.fullTextWeight,
    expandGraph: deps.expandGraph,
  };

  // Run every facet's hybrid retrieval concurrently — they are independent.
  const perFacet = await Promise.all(
    facets.map(async (f) => ({
      facet: f.facet,
      hits: await runHybrid(f.query, hybridDeps),
    }))
  );

  // Source data lookup keyed by id, so the pure fusion can stay id-only.
  const byId = new Map<string, RankedSource>();
  const facetLists: Partial<Record<RagFusionFacet, string[]>> = {};
  for (const { facet, hits } of perFacet) {
    facetLists[facet] = hits.map((h) => h.id);
    for (const h of hits) {
      if (!byId.has(h.id)) byId.set(h.id, h);
    }
  }

  const fused = fuseFacetRankings({
    facetLists,
    rrfK: deps.rrfK,
    facetWeights: deps.facetWeights,
  });

  const hits: RagFusionHit[] = fused
    .map((f): RagFusionHit | null => {
      const source = byId.get(f.id);
      if (!source) return null;
      return { ...source, rrfScore: f.rrfScore, facetRanks: f.facetRanks };
    })
    .filter((h): h is RagFusionHit => h !== null)
    .slice(0, finalLimit);

  return { facets, hits };
}
