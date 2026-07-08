import { getPool } from "../db";
import { embed, toPgVectorLiteral } from "../embeddings";
import { searchPubmed, fetchPubmedRecords } from "../sources/pubmed";
import { searchTrials, fetchTrialResults } from "../sources/clinicaltrials";
import { SourceCandidate } from "../schemas";

const SIMILARITY_THRESHOLD = 0.72; // cosine similarity; below this, treat as "no confident match"
const MAX_SOURCES = 3; // top-N confident matches returned for cross-verification

// When DEMO_MODE is on, retrieval NEVER live-fetches from PubMed/ClinicalTrials.gov —
// it answers only from the pre-ingested cache and returns null/empty on a miss. This keeps
// the live demo deterministic and off the network critical path: a judge pasting an
// off-distribution claim gets an honest "no confident match", never a mid-demo API
// stall or an accidental credit burn.
const DEMO_MODE = process.env.DEMO_MODE === "true";

// Columns selected for every SourceCandidate (kept identical across the queries below so
// phase/enrollment_count are always present, null for PubMed records).
const SOURCE_COLUMNS =
  "id, source_type, external_id, title, raw_text, url, phase, enrollment_count, registered_results";

/**
 * Return the top confident matching sources for a claim (best first), for
 * cross-verification. When the user pinned a cited source, that source leads.
 * Otherwise: pgvector similarity search over cached sources, filtered by threshold;
 * on a cold miss (and not DEMO_MODE), live-fetch + cache, then re-search.
 */
export async function retrieveSources(
  claim: string,
  opts?: { preferExternalId?: string }
): Promise<SourceCandidate[]> {
  const results: SourceCandidate[] = [];

  // Pin-to-source: the specific paper the user cited leads the list (similarity 1).
  if (opts?.preferExternalId) {
    const pinned = await findByExternalId(opts.preferExternalId);
    if (pinned) results.push(pinned);
  }

  const claimVector = await embed(claim);

  let confident = await searchConfidentSources(claimVector);
  if (confident.length === 0 && !DEMO_MODE) {
    // Cold cache: fetch from PubMed + ClinicalTrials.gov, cache, and re-search.
    await ingestLiveResults(claim);
    confident = await searchConfidentSources(claimVector);
  }

  for (const candidate of confident) {
    if (results.length >= MAX_SOURCES) break;
    if (results.some((r) => r.id === candidate.id)) continue; // dedupe the pinned source
    results.push(candidate);
  }

  return results.slice(0, MAX_SOURCES);
}

/**
 * Single best-matching source, or null. Thin wrapper over retrieveSources for
 * callers that only need the primary match (batch runs, back-compat).
 */
export async function retrieveSource(
  claim: string,
  opts?: { preferExternalId?: string }
): Promise<SourceCandidate | null> {
  const sources = await retrieveSources(claim, opts);
  return sources[0] ?? null;
}

/** Look up a cached source by its external id (PMID / NCT / DOI-derived). Returns a
 *  fully-confident candidate (similarity 1) so the pinned source is used directly. */
async function findByExternalId(externalId: string): Promise<SourceCandidate | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select ${SOURCE_COLUMNS}, 1.0 as similarity
     from sources where external_id = $1 limit 1`,
    [externalId]
  );
  return rows.length > 0 ? (rows[0] as SourceCandidate) : null;
}

/** Top-N cached sources by cosine similarity, filtered to the confidence threshold. */
async function searchConfidentSources(claimVector: number[]): Promise<SourceCandidate[]> {
  const pool = getPool();
  const vectorLiteral = toPgVectorLiteral(claimVector);
  const { rows } = await pool.query(
    `select ${SOURCE_COLUMNS},
            1 - (embedding <=> $1::vector) as similarity
     from sources
     where embedding is not null
     order by embedding <=> $1::vector
     limit $2`,
    [vectorLiteral, MAX_SOURCES]
  );
  return (rows as SourceCandidate[]).filter((r) => r.similarity >= SIMILARITY_THRESHOLD);
}

async function ingestLiveResults(claim: string): Promise<void> {
  const pool = getPool();

  const [pmids, trials] = await Promise.all([
    searchPubmed(claim, 3).catch(() => [] as string[]),
    searchTrials(claim, 3).catch(() => []),
  ]);
  const pubmedRecords = pmids.length > 0 ? await fetchPubmedRecords(pmids).catch(() => []) : [];

  // Fetch each trial's registered results once, at ingestion, so the deterministic
  // registry check reads from cache and never blocks the verify request.
  const trialResults = await Promise.all(
    trials.map((t) => fetchTrialResults(t.nctId).catch(() => []))
  );

  const toInsert: Array<{
    source_type: string;
    external_id: string;
    title: string;
    raw_text: string;
    url: string;
    phase: string | null;
    enrollment_count: number | null;
    registered_results: unknown[] | null;
  }> = [
    ...pubmedRecords.map((r) => ({
      source_type: "pubmed",
      external_id: r.pmid,
      title: r.title,
      raw_text: r.abstract,
      url: r.url,
      phase: null,
      enrollment_count: null,
      registered_results: null,
    })),
    ...trials.map((t, i) => ({
      source_type: "clinicaltrials",
      external_id: t.nctId,
      title: t.title,
      raw_text: t.summaryText,
      url: t.url,
      phase: t.phase,
      enrollment_count: t.enrollmentCount,
      registered_results: trialResults[i].length > 0 ? trialResults[i] : null,
    })),
  ];

  for (const record of toInsert) {
    if (!record.raw_text || record.raw_text.trim().length < 20) continue;
    try {
      const vector = await embed(record.raw_text);
      await pool.query(
        `insert into sources (source_type, external_id, title, raw_text, url, phase, enrollment_count, registered_results, embedding)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::vector)
         on conflict (source_type, external_id) do update
           set raw_text = excluded.raw_text, embedding = excluded.embedding,
               phase = excluded.phase, enrollment_count = excluded.enrollment_count,
               registered_results = excluded.registered_results`,
        [
          record.source_type,
          record.external_id,
          record.title,
          record.raw_text,
          record.url,
          record.phase,
          record.enrollment_count,
          record.registered_results ? JSON.stringify(record.registered_results) : null,
          toPgVectorLiteral(vector),
        ]
      );
    } catch (err) {
      // One bad record shouldn't sink the whole ingestion batch.
      console.error(`[retrievalAgent] failed to ingest ${record.source_type}:${record.external_id}`, err);
    }
  }
}
