// INGEST-TIME ENTITY CANONICALIZATION — tag a cached source document with the canonical
// ontology CURIEs it mentions, persisting the survivors into `document_entities`.
//
// This is the Phase-2 (multi-source ingest) glue that turns PaperTrail from a literature
// verifier into an EVIDENCE INTEGRATOR: every document pulled into the shared `sources`
// cache carries, at ingest time, the deterministic canonical identity of the entities it
// names, so downstream retrieval can ask "which cached sources mention HGNC:6024?" without
// ever re-running NER or re-fetching from the network (CLAUDE.md cache-everything rule).
//
// THE CHAIN (exactly Phase 1's architecture; Claude is used ONLY for NER):
//   1. recognizeEntities (lib/entities/ner.ts) — the ONLY Claude call — proposes surface
//      mentions, grounds each verbatim in the text (exact offsets) and drops the
//      ungroundable. Its cost controls / honest-empty degradation are reused as-is.
//   2. resolveMany (lib/entities/canonicalize.ts) — a PURE, deterministic lexical lookup
//      against the ontology tables — maps each grounded surface to a canonical CURIE.
//   3. Mentions that DO NOT resolve to a CURIE are DROPPED (and counted). PaperTrail never
//      persists an ungrounded entity claim (a wrong "confident" link is worse than none).
//   4. The survivors are UPSERTED into `document_entities` (idempotent per span), so
//      re-ingesting the same document does not duplicate its entities.
//
// No LLM in the LINKING step (step 1 is the only Claude call). Never logs source text —
// only ids and counts (CLAUDE.md logging rule).

import type { Pool } from "pg";
import { recognizeEntities } from "@/lib/entities/ner";
import { resolveMany, type CanonicalEntity } from "@/lib/entities/canonicalize";
import type { LinkedEntity } from "@/lib/entities/schemas";

// ---------------------------------------------------------------------------
// SHARED CONTRACT (lib/ingest/entityCanonicalization.ts). A DocumentEntity is one
// canonical entity mention persisted against a source: its CURIE + owning ontology, the
// verbatim surface substring, its offsets into the source text (null when the linker
// resolved a mention whose span could not be placed), and the deterministic linker
// provenance (matchType + score — never an LLM number).
// ---------------------------------------------------------------------------

export interface DocumentEntity {
  curie: string;
  surface: string;
  ontology: string;
  startOffset: number | null;
  endOffset: number | null;
  matchType: string;
  score: number;
}

// The result of canonicalizing one document: the persisted survivors + how many grounded
// mentions were dropped for failing to resolve to a canonical CURIE (honest count).
export interface CanonicalizationResult {
  entities: DocumentEntity[];
  dropped: number;
}

// ---------------------------------------------------------------------------
// Injectable dependencies so the whole module runs OFFLINE against deterministic mocks in
// tests (no Claude, no DB). Defaults wire the real Phase-1 NER + canonicalizer.
// ---------------------------------------------------------------------------

export interface CanonicalizationDeps {
  // NER (the ONLY Claude call). Returns grounded LinkedEntity[] with verbatim offsets.
  recognizeEntities: (input: { text: string }) => Promise<{ entities: LinkedEntity[] }>;
  // DETERMINISTIC batch canonicalizer. One slot per input surface: a CanonicalEntity or
  // null (honest per-surface miss), aligned 1:1 with `surfaces`.
  resolveMany: (
    pool: Pool,
    surfaces: readonly string[],
    type?: string
  ) => Promise<Array<CanonicalEntity | null>>;
}

const defaultDeps: CanonicalizationDeps = {
  recognizeEntities: (input) => recognizeEntities(input),
  resolveMany: (pool, surfaces, type) => resolveMany(pool, surfaces, type),
};

// The linker exposes a deterministic string-match score but no explicit match kind. An
// exact synonym hit scores 1.0 (see EXACT_MATCH_SCORE in canonicalize.ts); anything below
// is a normalized/fuzzy hit. We record that provenance so a persisted link is auditable.
const EXACT_SCORE = 1.0;

function matchTypeForScore(score: number): string {
  return score >= EXACT_SCORE ? "exact" : "normalized";
}

// ---------------------------------------------------------------------------
// Pair each grounded NER mention with the canonical resolution of its surface. Mentions
// are resolved in a single batch call (parallel inside resolveMany), aligned 1:1 by index
// with the surfaces we passed in. A null slot => the surface did not resolve => DROPPED.
// ---------------------------------------------------------------------------

function toDocumentEntities(
  mentions: readonly LinkedEntity[],
  resolutions: ReadonlyArray<CanonicalEntity | null>
): { entities: DocumentEntity[]; dropped: number } {
  const entities: DocumentEntity[] = [];
  let dropped = 0;

  for (let i = 0; i < mentions.length; i += 1) {
    const mention = mentions[i];
    const canonical = resolutions[i] ?? null;

    // Drop mentions that did not resolve to a canonical CURIE — never persist an
    // ungrounded entity claim.
    if (!canonical) {
      dropped += 1;
      continue;
    }

    entities.push({
      curie: canonical.curie,
      surface: mention.text,
      ontology: canonical.ontology,
      startOffset: Number.isInteger(mention.start) ? mention.start : null,
      endOffset: Number.isInteger(mention.end) ? mention.end : null,
      matchType: matchTypeForScore(canonical.score),
      score: canonical.score,
    });
  }

  return { entities, dropped };
}

// De-dupe canonical entities by (curie, span) BEFORE the DB write so a single batched
// upsert can't collide with itself within one statement (the unique index treats a null
// offset as -1 via coalesce; mirror that here so the in-memory de-dupe matches the DB's).
function dedupe(entities: readonly DocumentEntity[]): DocumentEntity[] {
  const byKey = new Map<string, DocumentEntity>();
  for (const e of entities) {
    const key = `${e.curie}:${e.startOffset ?? -1}:${e.endOffset ?? -1}`;
    if (!byKey.has(key)) byKey.set(key, e);
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------------------
// Persist the survivors into `document_entities` via a single parameterized batched
// upsert (unnest of typed arrays), idempotent on the (source_id, curie, span) unique
// index. Re-ingesting a document refreshes its entities without duplicating rows.
// ---------------------------------------------------------------------------

async function persist(
  pool: Pool,
  sourceId: string,
  entities: readonly DocumentEntity[]
): Promise<void> {
  if (entities.length === 0) return;

  const curies = entities.map((e) => e.curie);
  const surfaces = entities.map((e) => e.surface);
  const ontologies = entities.map((e) => e.ontology);
  const starts = entities.map((e) => e.startOffset);
  const ends = entities.map((e) => e.endOffset);
  const matchTypes = entities.map((e) => e.matchType);
  const scores = entities.map((e) => e.score);

  // Parameterized arrays only — never string-interpolate the surface (source text) into
  // SQL. The upsert refreshes surface/match provenance if the same span is re-linked.
  await pool.query(
    `insert into document_entities
       (source_id, curie, surface, ontology, start_offset, end_offset, match_type, score)
     select $1,
            u.curie, u.surface, u.ontology,
            u.start_offset, u.end_offset, u.match_type, u.score
       from unnest(
              $2::text[], $3::text[], $4::text[],
              $5::int[], $6::int[], $7::text[], $8::float8[]
            ) as u(curie, surface, ontology, start_offset, end_offset, match_type, score)
     on conflict (source_id, curie, coalesce(start_offset, -1), coalesce(end_offset, -1))
       do update set
         surface    = excluded.surface,
         ontology   = excluded.ontology,
         match_type = excluded.match_type,
         score      = excluded.score,
         linked_at  = now()`,
    [sourceId, curies, surfaces, ontologies, starts, ends, matchTypes, scores]
  );
}

// ---------------------------------------------------------------------------
// canonicalizeSourceEntities — the public entry point (SHARED CONTRACT).
//
// Run NER over `text` (the ONLY Claude call), canonicalize each grounded surface against
// the ontology tables (deterministic), DROP the mentions that do not resolve (counting
// them), and upsert the survivors into `document_entities` for `sourceId`.
//
// Degrades HONESTLY: an empty/failed NER pass yields zero entities and zero dropped
// (nothing to link), never a fabricated entity. Never logs source text.
// ---------------------------------------------------------------------------

export async function canonicalizeSourceEntities(
  pool: Pool,
  sourceId: string,
  text: string,
  deps: CanonicalizationDeps = defaultDeps
): Promise<CanonicalizationResult> {
  const body = typeof text === "string" ? text : "";
  if (body.trim().length === 0 || typeof sourceId !== "string" || sourceId.length === 0) {
    return { entities: [], dropped: 0 };
  }

  // 1. NER — the only Claude call; honest-empty on failure (recognizeEntities already
  //    catches its own LLM failures internally, but we guard the boundary too).
  const ner = await deps.recognizeEntities({ text: body }).catch(
    () => ({ entities: [] as LinkedEntity[] })
  );
  const mentions = ner.entities;
  if (mentions.length === 0) return { entities: [], dropped: 0 };

  // 2. Canonicalize each grounded surface (deterministic; no LLM). We pass the NER-tagged
  //    entity TYPE per surface so a same-spelling concept of a different kind can't win —
  //    resolveMany applies one `type` across the batch, so group surfaces by type and
  //    resolve each group with its own type, then re-align to the original mention order.
  const resolutions = await resolveTypedSurfaces(pool, deps, mentions);

  // 3. Drop unresolved mentions (counted); shape survivors into DocumentEntity rows.
  const { entities, dropped } = toDocumentEntities(mentions, resolutions);
  const deduped = dedupe(entities);

  // 4. Persist survivors (idempotent per span).
  await persist(pool, sourceId, deduped);

  return { entities: deduped, dropped };
}

// resolveMany applies a SINGLE `type` filter across the whole batch, but NER tags a coarse
// type per mention (gene/disease/chemical/variant). To keep the type-narrowing that
// prevents a same-spelling cross-type link, resolve each type-group separately then
// re-project the results back onto the original mention order (1:1, null for misses).
async function resolveTypedSurfaces(
  pool: Pool,
  deps: CanonicalizationDeps,
  mentions: readonly LinkedEntity[]
): Promise<Array<CanonicalEntity | null>> {
  // Group the mention indices by their tagged type.
  const indicesByType = new Map<string, number[]>();
  for (let i = 0; i < mentions.length; i += 1) {
    const type = mentions[i].type;
    const bucket = indicesByType.get(type);
    if (bucket) bucket.push(i);
    else indicesByType.set(type, [i]);
  }

  const out: Array<CanonicalEntity | null> = new Array(mentions.length).fill(null);

  // Resolve every type-group in parallel; each group uses its own type filter.
  await Promise.all(
    [...indicesByType.entries()].map(async ([type, indices]) => {
      const surfaces = indices.map((i) => mentions[i].text);
      const resolved = await deps.resolveMany(pool, surfaces, type);
      for (let j = 0; j < indices.length; j += 1) {
        out[indices[j]] = resolved[j] ?? null;
      }
    })
  );

  return out;
}
