import "dotenv/config";
import { getPool } from "../lib/db";
import { embed, toPgVectorLiteral } from "../lib/embeddings";
import { searchPubmed, fetchPubmedRecords } from "../lib/sources/pubmed";
import { searchTrials, fetchTrialResults } from "../lib/sources/clinicaltrials";
import demoClaims from "../tests/fixtures/demo-claims.json";

// Pre-warms the sources table with a curated set of queries relevant to your
// demo claims, so the live demo doesn't depend on PubMed/ClinicalTrials.gov
// API latency or availability. Edit DEMO_QUERIES to match whatever claims
// you've locked in for your demo script (see docs/demo-script.md).

const DEMO_QUERIES = [
  "SGLT2 inhibitor heart failure hospitalization reduced ejection fraction",
  "cardiovascular disease type 2 diabetes major adverse events trial",
];

interface DemoClaim {
  source_type: string;
  source_external_id: string;
  source_url: string;
}

interface SourceUpsert {
  source_type: string;
  external_id: string;
  title: string;
  raw_text: string;
  url: string;
  phase?: string | null;
  enrollment_count?: number | null;
  registered_results?: unknown[] | null;
}

// Embed + upsert a single source row. Shared by query ingestion and pinned seeding.
async function upsertSource(
  pool: ReturnType<typeof getPool>,
  c: SourceUpsert
): Promise<boolean> {
  if (!c.raw_text || c.raw_text.trim().length < 20) return false;
  const vector = await embed(c.raw_text);
  await pool.query(
    `insert into sources (source_type, external_id, title, raw_text, url, phase, enrollment_count, registered_results, embedding)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::vector)
     on conflict (source_type, external_id) do update
       set raw_text = excluded.raw_text, embedding = excluded.embedding,
           phase = excluded.phase, enrollment_count = excluded.enrollment_count,
           registered_results = excluded.registered_results`,
    [
      c.source_type,
      c.external_id,
      c.title,
      c.raw_text,
      c.url,
      c.phase ?? null,
      c.enrollment_count ?? null,
      c.registered_results ? JSON.stringify(c.registered_results) : null,
      toPgVectorLiteral(vector),
    ]
  );
  console.log(`  ingested ${c.source_type}:${c.external_id} - ${c.title.slice(0, 60)}`);
  return true;
}

async function main() {
  const pool = getPool();
  let inserted = 0;

  for (const query of DEMO_QUERIES) {
    console.log(`\nIngesting for query: "${query}"`);

    const pmids = await searchPubmed(query, 3);
    const pubmedRecords = pmids.length > 0 ? await fetchPubmedRecords(pmids) : [];
    const trials = await searchTrials(query, 3);
    const trialResults = await Promise.all(
      trials.map((t) => fetchTrialResults(t.nctId).catch(() => []))
    );

    const candidates = [
      ...pubmedRecords.map((r) => ({
        source_type: "pubmed",
        external_id: r.pmid,
        title: r.title,
        raw_text: r.abstract,
        url: r.url,
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

    for (const c of candidates) {
      if (await upsertSource(pool, c)) inserted += 1;
    }
  }

  // Additionally seed the PINNED demo sources referenced by tests/fixtures/demo-claims.json,
  // fetched by exact ID (not by query), so the eval harness has deterministic sources to
  // score against regardless of what the free-text queries above happen to return. We only
  // pin PubMed sources here (fetch-by-ID via efetch); other source_types are left to the
  // query ingestion above.
  const pinnedPmids = Array.from(
    new Set(
      (demoClaims as DemoClaim[])
        .filter((f) => f.source_type === "pubmed")
        .map((f) => f.source_external_id)
    )
  );

  if (pinnedPmids.length > 0) {
    console.log(`\nSeeding ${pinnedPmids.length} pinned demo PubMed source(s): ${pinnedPmids.join(", ")}`);
    const pinnedRecords = await fetchPubmedRecords(pinnedPmids);
    for (const r of pinnedRecords) {
      const ok = await upsertSource(pool, {
        source_type: "pubmed",
        external_id: r.pmid,
        title: r.title,
        raw_text: r.abstract,
        url: r.url,
      });
      if (ok) inserted += 1;
    }
    const fetchedIds = new Set(pinnedRecords.map((r) => r.pmid));
    for (const pmid of pinnedPmids) {
      if (!fetchedIds.has(pmid)) {
        console.log(`  WARNING: pinned PubMed ${pmid} returned no usable abstract; eval will SKIP it`);
      }
    }
  }

  console.log(`\nDone. Ingested/updated ${inserted} sources.`);
  await pool.end();
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
