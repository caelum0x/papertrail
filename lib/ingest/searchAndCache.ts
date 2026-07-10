import type { Pool } from "pg";
import { embed, toPgVectorLiteral } from "../embeddings";
import {
  searchPubmed,
  fetchPubmedRecords,
  type PubmedRecord,
} from "../sources/pubmed";
import {
  searchTrials,
  fetchTrialResults,
  type TrialRecord,
  type TrialResultAnalysis,
} from "../sources/clinicaltrials";
import {
  searchOpenAlex,
  isOpenAlexEnabled,
  type OpenAlexWork,
} from "../engines/openalex";

// Live SOURCE INGESTION with STRICT caching.
//
// Given a free-text query, this module searches PubMed + ClinicalTrials.gov and caches
// the results into the `sources` table so downstream synthesis/retrieval works on real
// literature — but it NEVER re-fetches what is already cached (CLAUDE.md caching rule:
// the demo must not depend on live API latency, and the $200 credit budget must not be
// burned re-embedding rows we already have).
//
// The cache key is the SAME uniqueness constraint the rest of the codebase uses:
// (source_type, external_id). We resolve candidate external ids from the search APIs,
// subtract the ids already present in `sources`, and only fetch/embed/insert the new
// remainder. The insert path is the exact `on conflict (source_type, external_id)`
// upsert used by lib/agents/retrievalAgent.ts — we do NOT invent a new schema.
//
// All network + DB effects are confined here and are INJECTABLE (see IngestDeps) so the
// module is unit-testable with a mock fetcher + mock pool. Never logs claim/query text.

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const MIN_RAW_TEXT_LENGTH = 20; // skip degenerate records with no usable text

export interface SearchAndCacheParams {
  query: string;
  limit?: number;
}

export interface SearchAndCacheResult {
  // All cached source ids relevant to this query — both the rows we reused and the
  // rows we just inserted. This is what downstream synthesis consumes.
  cachedSourceIds: string[];
  // How many NEW rows were fetched from the network and inserted this call.
  fetchedCount: number;
  // How many already-cached rows were reused (no re-fetch, no re-embed).
  reusedCount: number;
}

// A resolved candidate to (maybe) fetch: identified purely by its cache key before we
// spend any network/embedding budget on it. ClinicalTrials candidates carry the full
// TrialRecord from the search step so the fetch phase never re-searches.
interface Candidate {
  source_type: "pubmed" | "clinicaltrials";
  external_id: string;
  record?: TrialRecord;
  // OpenAlex candidates carry their already-fetched work (the bridge reconstructs the
  // abstract) so the fetch phase never re-queries the network for them. They are keyed
  // under the PubMed-compatible `source_type` so the downstream SourceCandidate schema
  // (owned elsewhere) still validates without a new enum member.
  openAlexWork?: OpenAlexWork;
}

// The full row we upsert once a NEW candidate has been fetched.
interface FetchedRow {
  source_type: "pubmed" | "clinicaltrials";
  external_id: string;
  title: string;
  raw_text: string;
  url: string;
  phase: string | null;
  enrollment_count: number | null;
  registered_results: TrialResultAnalysis[] | null;
}

// Everything that touches the network or the embedding provider is injected, so the
// test can pass deterministic stubs and assert the fetchers are NOT called for ids that
// are already cached. Defaults wire up the real lib/sources + lib/embeddings functions.
export interface IngestDeps {
  searchPubmed: (query: string, retmax: number) => Promise<string[]>;
  fetchPubmedRecords: (pmids: string[]) => Promise<PubmedRecord[]>;
  searchTrials: (query: string, pageSize: number) => Promise<TrialRecord[]>;
  fetchTrialResults: (nctId: string) => Promise<TrialResultAnalysis[]>;
  embed: (text: string) => Promise<number[]>;
  // OPT-IN OpenAlex corpus search (OFF by default). When enabled, works are fetched as
  // an ADDITIONAL provider alongside PubMed + ClinicalTrials.gov. Optional so existing
  // callers/tests that omit them get the exact prior behavior; defaults wire the bridge.
  isOpenAlexEnabled?: () => boolean;
  searchOpenAlex?: (input: { query: string; limit?: number }) => Promise<{
    works: OpenAlexWork[];
  }>;
}

const defaultDeps: IngestDeps = {
  searchPubmed,
  fetchPubmedRecords,
  searchTrials,
  fetchTrialResults,
  embed,
  isOpenAlexEnabled,
  searchOpenAlex,
};

interface CachedRow {
  id: string;
  source_type: string;
  external_id: string;
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || limit === undefined) return DEFAULT_LIMIT;
  const n = Math.floor(limit);
  if (n < 1) return 1;
  if (n > MAX_LIMIT) return MAX_LIMIT;
  return n;
}

function cacheKey(sourceType: string, externalId: string): string {
  return `${sourceType}:${externalId}`;
}

/**
 * Which of the candidate cache keys are ALREADY in the `sources` table. One
 * parameterized round-trip; returns a map keyed by `source_type:external_id` so callers
 * can both dedupe fetches and collect the reused ids.
 */
async function lookupCached(
  pool: Pool,
  candidates: readonly Candidate[]
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (candidates.length === 0) return found;

  const types = candidates.map((c) => c.source_type);
  const ids = candidates.map((c) => c.external_id);

  // Match on the (source_type, external_id) pair via unnest so a PMID that happens to
  // collide with an NCT string can't cross-match. Parameterized arrays only.
  const { rows } = await pool.query<CachedRow>(
    `select id, source_type, external_id
       from sources
      where (source_type, external_id) in (
        select * from unnest($1::text[], $2::text[])
      )`,
    [types, ids]
  );

  for (const row of rows) {
    found.set(cacheKey(row.source_type, row.external_id), row.id);
  }
  return found;
}

/**
 * Fetch the full record text + metadata for the NEW candidates only, grouped by source
 * type so each upstream API is called at most once. Records with no usable text are
 * dropped here (before we spend an embedding on them).
 */
async function fetchNewRecords(
  deps: IngestDeps,
  newCandidates: readonly Candidate[]
): Promise<FetchedRow[]> {
  // OpenAlex candidates are keyed under "pubmed" but carry their own already-fetched
  // work — they must NOT be sent to the PubMed efetch (their id is a W-id, not a PMID).
  const pmids = newCandidates
    .filter((c) => c.source_type === "pubmed" && !c.openAlexWork)
    .map((c) => c.external_id);
  const nctIds = new Set(
    newCandidates.filter((c) => c.source_type === "clinicaltrials").map((c) => c.external_id)
  );

  const rows: FetchedRow[] = [];

  // OpenAlex: no network re-fetch — the bridge already returned the reconstructed
  // abstract. Map each carried work into the same cached-source row shape. The DOI, when
  // present, forms a stable canonical url; otherwise the OpenAlex landing page is used.
  for (const c of newCandidates) {
    const work = c.openAlexWork;
    if (!work) continue;
    const doiUrl =
      work.doi && work.doi.length > 0
        ? work.doi.startsWith("http")
          ? work.doi
          : `https://doi.org/${work.doi}`
        : null;
    rows.push({
      source_type: "pubmed",
      external_id: c.external_id,
      title: work.title ?? "",
      raw_text: work.abstract ?? "",
      url: doiUrl ?? `https://openalex.org/${c.external_id}`,
      phase: null,
      enrollment_count: null,
      registered_results: null,
    });
  }

  // PubMed: one batched efetch for all new PMIDs.
  if (pmids.length > 0) {
    const records = await deps.fetchPubmedRecords(pmids).catch(() => [] as PubmedRecord[]);
    for (const r of records) {
      rows.push({
        source_type: "pubmed",
        external_id: r.pmid,
        title: r.title,
        raw_text: r.abstract,
        url: r.url,
        phase: null,
        enrollment_count: null,
        registered_results: null,
      });
    }
  }

  // ClinicalTrials: searchTrials already returned the full TrialRecord in the search
  // step; we only need to pull each NEW trial's registered results (cached at ingestion
  // so the deterministic registry check never blocks a verify request).
  if (nctIds.size > 0) {
    // The trial records are carried in via the candidate resolution step; see resolve().
    for (const c of newCandidates) {
      if (c.source_type !== "clinicaltrials") continue;
      const trial = c.record;
      if (!trial) continue;
      const results = await deps.fetchTrialResults(trial.nctId).catch(() => [] as TrialResultAnalysis[]);
      rows.push({
        source_type: "clinicaltrials",
        external_id: trial.nctId,
        title: trial.title,
        raw_text: trial.summaryText,
        url: trial.url,
        phase: trial.phase,
        enrollment_count: trial.enrollmentCount,
        registered_results: results.length > 0 ? results : null,
      });
    }
  }

  return rows.filter((r) => r.raw_text && r.raw_text.trim().length >= MIN_RAW_TEXT_LENGTH);
}

/**
 * Upsert one fetched row via the SAME on-conflict path used by retrievalAgent.
 * Embedding is computed here (only for new rows). Returns the row id.
 */
async function upsertRow(
  pool: Pool,
  deps: IngestDeps,
  row: FetchedRow
): Promise<string | null> {
  const vector = await deps.embed(row.raw_text);
  const { rows } = await pool.query<{ id: string }>(
    `insert into sources (source_type, external_id, title, raw_text, url, phase, enrollment_count, registered_results, embedding)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::vector)
     on conflict (source_type, external_id) do update
       set raw_text = excluded.raw_text, embedding = excluded.embedding,
           phase = excluded.phase, enrollment_count = excluded.enrollment_count,
           registered_results = excluded.registered_results
     returning id`,
    [
      row.source_type,
      row.external_id,
      row.title,
      row.raw_text,
      row.url,
      row.phase,
      row.enrollment_count,
      row.registered_results ? JSON.stringify(row.registered_results) : null,
      toPgVectorLiteral(vector),
    ]
  );
  return rows[0]?.id ?? null;
}

/**
 * Resolve the candidate cache keys from both search APIs. For ClinicalTrials we attach
 * the full TrialRecord to the candidate so the fetch step doesn't re-search. PubMed only
 * yields ids here (the abstract text comes from the batched efetch later). Search
 * failures degrade to an empty list per source — one dead API never sinks the other.
 */
async function resolveCandidates(
  deps: IngestDeps,
  query: string,
  limit: number
): Promise<Candidate[]> {
  const [pmids, trials] = await Promise.all([
    deps.searchPubmed(query, limit).catch(() => [] as string[]),
    deps.searchTrials(query, limit).catch(() => [] as TrialRecord[]),
  ]);

  const pubmedCandidates: Candidate[] = pmids
    .filter((id) => typeof id === "string" && id.length > 0)
    .map((id) => ({ source_type: "pubmed", external_id: id }));

  const trialCandidates: Array<Candidate & { record: TrialRecord }> = trials
    .filter((t) => t && typeof t.nctId === "string" && t.nctId.length > 0 && t.nctId !== "unknown")
    .map((t) => ({ source_type: "clinicaltrials", external_id: t.nctId, record: t }));

  // ADDITIONAL provider: OpenAlex Works. OPT-IN and best-effort — a rejection (Python
  // missing, timeout, disabled) silently yields no candidates so PubMed + CT.gov still
  // ingest normally. Works arrive with their abstract already reconstructed by the
  // bridge, so no fetch phase re-query is needed; the work is carried on the candidate.
  const openAlexCandidates = await resolveOpenAlexCandidates(deps, query, limit);

  return [...pubmedCandidates, ...trialCandidates, ...openAlexCandidates];
}

/**
 * Resolve OpenAlex Works into cache-key candidates, keyed under the PubMed-compatible
 * `source_type` with the OpenAlex short id as `external_id`. Returns [] when the engine
 * is disabled, unavailable, or the search rejects — OpenAlex never sinks the other
 * providers. Never logs the query text (the bridge already keeps it off argv/logs).
 */
async function resolveOpenAlexCandidates(
  deps: IngestDeps,
  query: string,
  limit: number
): Promise<Candidate[]> {
  if (!deps.isOpenAlexEnabled?.() || !deps.searchOpenAlex) return [];

  const result = await deps.searchOpenAlex({ query, limit }).catch(() => null);
  if (!result || !Array.isArray(result.works)) return [];

  return result.works
    .filter(
      (w): w is OpenAlexWork & { openalex_id: string } =>
        !!w && typeof w.openalex_id === "string" && w.openalex_id.length > 0
    )
    .map((w) => ({
      source_type: "pubmed" as const,
      external_id: w.openalex_id,
      openAlexWork: w,
    }));
}

/**
 * Search PubMed + ClinicalTrials.gov for `query` and cache the results into the
 * `sources` table, reusing already-cached rows and fetching/embedding ONLY new ones.
 *
 * @param pool  Postgres pool (real, or a mock exposing `.query`) — the only DB surface.
 * @param deps  Injectable network + embedding functions; defaults to the real providers.
 */
export async function searchAndCache(
  pool: Pool,
  { query, limit }: SearchAndCacheParams,
  deps: IngestDeps = defaultDeps
): Promise<SearchAndCacheResult> {
  const trimmed = typeof query === "string" ? query.trim() : "";
  if (trimmed.length === 0) {
    return { cachedSourceIds: [], fetchedCount: 0, reusedCount: 0 };
  }
  const effectiveLimit = clampLimit(limit);

  // 1. Resolve candidate cache keys from the search APIs.
  const candidates = await resolveCandidates(deps, trimmed, effectiveLimit);

  // De-dupe candidate keys (a search API can echo an id twice; a PMID and NCT can't
  // collide because the key includes source_type).
  const seen = new Set<string>();
  const uniqueCandidates = candidates.filter((c) => {
    const key = cacheKey(c.source_type, c.external_id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (uniqueCandidates.length === 0) {
    return { cachedSourceIds: [], fetchedCount: 0, reusedCount: 0 };
  }

  // 2. Look up which candidates are ALREADY cached — these are reused, never re-fetched.
  const cached = await lookupCached(pool, uniqueCandidates);

  const reusedIds: string[] = [];
  const newCandidates: Candidate[] = [];
  for (const c of uniqueCandidates) {
    const existingId = cached.get(cacheKey(c.source_type, c.external_id));
    if (existingId) {
      reusedIds.push(existingId);
    } else {
      newCandidates.push(c);
    }
  }

  // 3. Fetch + embed + upsert ONLY the new candidates. The fetchers are never invoked
  //    for ids resolved to a cached row above.
  const fetchedIds: string[] = [];
  if (newCandidates.length > 0) {
    const fetchedRows = await fetchNewRecords(deps, newCandidates);
    for (const row of fetchedRows) {
      try {
        const id = await upsertRow(pool, deps, row);
        if (id) fetchedIds.push(id);
      } catch {
        // One bad record must not sink the batch; skip it and keep ingesting. Nothing
        // that could contain claim/query text is logged.
      }
    }
  }

  // Preserve reused-then-fetched ordering; de-dupe defensively in case an upsert
  // returned an id that also appeared in the reused set (concurrent ingest of the same
  // query).
  const cachedSourceIds = Array.from(new Set([...reusedIds, ...fetchedIds]));

  return {
    cachedSourceIds,
    fetchedCount: fetchedIds.length,
    reusedCount: reusedIds.length,
  };
}
