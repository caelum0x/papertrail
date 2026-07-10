import { describe, it, expect, vi } from "vitest";
import { searchAndCache, type IngestDeps } from "../lib/ingest/searchAndCache";
import type { PubmedRecord } from "../lib/sources/pubmed";
import type { TrialRecord, TrialResultAnalysis } from "../lib/sources/clinicaltrials";

// One focused test of the STRICT-caching contract: given a search that returns one
// already-cached id and one new id, the module must (a) reuse the cached row without
// calling the record fetcher for it, and (b) fetch + embed + insert the new row exactly
// once. Network + DB are fully mocked — no live PubMed/CT.gov, no real Postgres.

// A mock pg pool: the lookupCached query returns whichever rows we seed as "already
// cached"; the insert query returns a fresh id. We record every SQL call so we can
// assert the insert ran once for the new candidate.
function makeMockPool(seedCachedNctId: string) {
  const inserts: unknown[][] = [];
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes("from sources") && sql.includes("unnest")) {
      // Cache lookup: report the seeded NCT as already present, PMID as absent.
      return {
        rows: [{ id: "cached-uuid-1", source_type: "clinicaltrials", external_id: seedCachedNctId }],
      };
    }
    if (sql.trimStart().startsWith("insert into sources")) {
      inserts.push(params);
      return { rows: [{ id: "new-uuid-1" }] };
    }
    return { rows: [] };
  });
  return { pool: { query } as never, query, inserts };
}

const NEW_PMID = "40000001";
const CACHED_NCT = "NCT01234567";

function makeDeps(): IngestDeps & {
  fetchPubmedRecords: ReturnType<typeof vi.fn>;
  fetchTrialResults: ReturnType<typeof vi.fn>;
  embed: ReturnType<typeof vi.fn>;
} {
  return {
    searchPubmed: vi.fn(async (): Promise<string[]> => [NEW_PMID]),
    searchTrials: vi.fn(
      async (): Promise<TrialRecord[]> => [
        {
          nctId: CACHED_NCT,
          title: "A cached trial",
          summaryText: "This trial is already cached in the sources table and must not be re-fetched.",
          url: `https://clinicaltrials.gov/study/${CACHED_NCT}`,
          phase: "PHASE3",
          enrollmentCount: 500,
        },
      ]
    ),
    fetchPubmedRecords: vi.fn(
      async (pmids: string[]): Promise<PubmedRecord[]> =>
        pmids.map((pmid) => ({
          pmid,
          title: "A newly fetched paper",
          abstract: "This abstract is long enough to pass the minimum raw-text guard for insertion.",
          url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        }))
    ),
    fetchTrialResults: vi.fn(async (): Promise<TrialResultAnalysis[]> => []),
    embed: vi.fn(async (): Promise<number[]> => [0.1, 0.2, 0.3]),
  };
}

describe("searchAndCache — strict caching contract", () => {
  it("reuses cached ids (never re-fetches them) and inserts only new rows once", async () => {
    const { pool, inserts } = makeMockPool(CACHED_NCT);
    const deps = makeDeps();

    const result = await searchAndCache(pool, { query: "drug x cardiovascular outcomes" }, deps);

    // The already-cached NCT is reused; the new PMID is fetched + inserted.
    expect(result.reusedCount).toBe(1);
    expect(result.fetchedCount).toBe(1);
    expect(result.cachedSourceIds).toEqual(["cached-uuid-1", "new-uuid-1"]);

    // The cached trial's RESULTS fetcher must NOT run — that trial is already cached.
    expect(deps.fetchTrialResults).not.toHaveBeenCalled();

    // Only the new PMID hits the record fetcher, and only once.
    expect(deps.fetchPubmedRecords).toHaveBeenCalledTimes(1);
    expect(deps.fetchPubmedRecords).toHaveBeenCalledWith([NEW_PMID]);

    // Exactly one insert, and it embedded the new row exactly once.
    expect(inserts).toHaveLength(1);
    expect(deps.embed).toHaveBeenCalledTimes(1);
    // The insert carried the new PMID as its external_id (param index 1).
    expect(inserts[0]?.[1]).toBe(NEW_PMID);
  });

  it("returns empty result and touches nothing for a blank query", async () => {
    const { pool, query } = makeMockPool(CACHED_NCT);
    const deps = makeDeps();

    const result = await searchAndCache(pool, { query: "   " }, deps);

    expect(result).toEqual({ cachedSourceIds: [], fetchedCount: 0, reusedCount: 0 });
    expect(deps.searchPubmed).not.toHaveBeenCalled();
    expect(deps.searchTrials).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});
