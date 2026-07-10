// READ-side queries for the INGEST-TIME entity index (document_entities).
//
// The by-entity routes answer "which cached sources mention this canonical entity?" by
// joining document_entities -> sources. This serves purely from the shared cache — no NER,
// no network, no LLM (CLAUDE.md cache-everything rule). Parameterized $1 SQL only; never
// interpolate the CURIE. Returns a stable, deterministic ordering so the demo is
// reproducible.

import type { Pool } from "pg";

// One cached source tagged with the queried canonical entity. `matchCount` is how many
// distinct mention spans of that entity occur in the document (a cheap salience signal);
// `bestScore` is the strongest deterministic link score among those spans. `surfaces` are
// the distinct verbatim substrings that were tagged (capped) so a caller can show WHY the
// document matched without re-reading raw_text.
export interface EntitySourceRow {
  sourceId: string;
  sourceType: string;
  externalId: string;
  title: string | null;
  url: string;
  matchCount: number;
  bestScore: number;
  surfaces: string[];
}

// A page of sources for a canonical entity plus the total distinct-source count (for the
// { total, page, limit } response meta).
export interface EntitySourcesPage {
  curie: string;
  sources: EntitySourceRow[];
  total: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
// Cap the distinct surfaces returned per source so a pathological document can't bloat the
// response; the count is unaffected (matchCount is the true span count).
const MAX_SURFACES_PER_SOURCE = 5;

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  const n = Math.floor(limit);
  if (n < 1) return 1;
  if (n > MAX_LIMIT) return MAX_LIMIT;
  return n;
}

export function clampOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  const n = Math.floor(offset);
  return n < 0 ? 0 : n;
}

interface RawRow {
  source_id: string;
  source_type: string;
  external_id: string;
  title: string | null;
  url: string;
  match_count: string | number;
  best_score: string | number;
  surfaces: string[] | null;
}

function toNumber(v: string | number): number {
  return typeof v === "number" ? v : Number(v);
}

/**
 * The cached sources tagged with `curie`, one row per distinct source, ordered by mention
 * salience (match count desc, then best link score desc, then a stable id tiebreak). Paged
 * via limit/offset. Returns the total distinct-source count alongside the page so the
 * caller can build response meta. Serves entirely from the cache (document_entities ->
 * sources) — no live fetch.
 *
 * @param pool   Postgres pool (real, or a mock exposing `.query`).
 * @param curie  Canonical ontology CURIE to look up (e.g. "HGNC:6024"). Exact match.
 * @param limit  Page size (clamped 1..100).
 * @param offset Page offset (>= 0).
 */
export async function getSourcesForEntity(
  pool: Pool,
  curie: string,
  limit: number,
  offset: number
): Promise<EntitySourcesPage> {
  const normalizedCurie = curie.trim();
  if (normalizedCurie.length === 0) {
    return { curie: normalizedCurie, sources: [], total: 0 };
  }

  const effectiveLimit = clampLimit(limit);
  const effectiveOffset = clampOffset(offset);

  // total distinct sources for this entity — for the { total } meta. Separate cheap count
  // so pagination reports the true size, not just the returned page length.
  const totalResult = await pool.query<{ total: string | number }>(
    `select count(distinct de.source_id) as total
       from document_entities de
      where de.curie = $1`,
    [normalizedCurie]
  );
  const total = toNumber(totalResult.rows[0]?.total ?? 0);
  if (total === 0) {
    return { curie: normalizedCurie, sources: [], total: 0 };
  }

  // The page: one row per source, aggregating its mention spans of this entity. Distinct
  // surfaces are capped in-SQL via a lateral so a document with hundreds of mentions can't
  // bloat the payload. Deterministic ordering keeps the demo reproducible.
  const { rows } = await pool.query<RawRow>(
    `select s.id            as source_id,
            s.source_type   as source_type,
            s.external_id   as external_id,
            s.title         as title,
            s.url           as url,
            count(*)        as match_count,
            max(de.score)   as best_score,
            (
              select array_agg(x.surface)
                from (
                  select distinct de2.surface
                    from document_entities de2
                   where de2.source_id = s.id and de2.curie = $1
                   order by de2.surface
                   limit $2
                ) as x
            )               as surfaces
       from document_entities de
       join sources s on s.id = de.source_id
      where de.curie = $1
      group by s.id, s.source_type, s.external_id, s.title, s.url
      order by match_count desc, best_score desc, s.id asc
      limit $3 offset $4`,
    [normalizedCurie, MAX_SURFACES_PER_SOURCE, effectiveLimit, effectiveOffset]
  );

  const sources: EntitySourceRow[] = rows.map((r) => ({
    sourceId: r.source_id,
    sourceType: r.source_type,
    externalId: r.external_id,
    title: r.title,
    url: r.url,
    matchCount: toNumber(r.match_count),
    bestScore: toNumber(r.best_score),
    surfaces: Array.isArray(r.surfaces) ? r.surfaces.filter((v): v is string => typeof v === "string") : [],
  }));

  return { curie: normalizedCurie, sources, total };
}
