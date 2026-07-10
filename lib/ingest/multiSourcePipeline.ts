import type { Pool } from "pg";
import { embed, toPgVectorLiteral } from "@/lib/embeddings";
import { canonicalizeSourceEntities } from "@/lib/ingest/entityCanonicalization";
import {
  recordAccess,
  recordSourceVersion,
  computeSnapshotId,
  snapshotContentFor,
} from "@/lib/ingest/provenance";
import type {
  CacheableSourceRecord,
  DriverContext,
  IngestDriver,
} from "@/lib/ingest/drivers/types";
import { faersDriver } from "@/lib/ingest/drivers/faers";
import { clinvarDriver } from "@/lib/ingest/drivers/clinvar";
import { chemblDriver } from "@/lib/ingest/drivers/chembl";
import { openTargetsDriver } from "@/lib/ingest/drivers/openTargets";
import { pubtatorDriver } from "@/lib/ingest/drivers/pubtator";

// MULTI-SOURCE INGEST PIPELINE — the additive orchestrator that turns PaperTrail from a
// literature verifier into an EVIDENCE INTEGRATOR. Given a query/entity, it fans out to
// the per-source drivers (FAERS / ClinVar / ChEMBL / Open Targets / PubTator), caches each
// returned record into the shared `sources` table exactly ONCE (never re-fetching a cached
// (source_type, external_id)), records per-source PROVENANCE (deterministic snapshot id +
// access log), and canonicalizes each NEW source's text into `document_entities`.
//
// MOAT / rules honored here:
//   * cache-everything: a (source_type, external_id) already in `sources` is REUSED — the
//     driver still produced the record, but we skip the embed + insert and DON'T re-run
//     entity canonicalization. The demo never depends on a live re-fetch.
//   * deterministic provenance: the snapshot id is a content hash (provenance.ts), never a
//     wall-clock value.
//   * no LLM in the numeric/linking path: drivers wrap deterministic bio engines; the only
//     Claude call is NER inside canonicalizeSourceEntities (owned by that module).
//   * never log raw source/claim text: we log ids/counts only.
//
// This module does NOT rewrite searchAndCache.ts; it is a parallel, self-contained
// orchestrator for the biomedical drivers (which produce non-pubmed/clinicaltrials source
// types) using the same on-conflict (source_type, external_id) upsert shape.

// ---------------------------------------------------------------------------
// SHARED CONTRACT (see build-multisource-ingest.js). Other parts code against these.
// ---------------------------------------------------------------------------

export interface IngestInput {
  query?: string;
  entity?: { surface?: string; curie?: string; type?: string };
  sources?: string[];
  limit?: number;
}

export interface SourceIngestResult {
  source_type: string;
  external_id: string;
  cached: boolean;
  entitiesLinked: number;
}

export interface MultiSourceIngestResult {
  ingested: SourceIngestResult[];
  coverage: Record<string, number>;
  droppedUngrounded: number;
}

// ---------------------------------------------------------------------------
// Configuration.
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const MIN_RAW_TEXT_LENGTH = 20; // skip degenerate records with no usable text

// The registry of available drivers, keyed by their source_type selection key.
const DRIVERS: readonly IngestDriver[] = [
  faersDriver,
  clinvarDriver,
  chemblDriver,
  openTargetsDriver,
  pubtatorDriver,
];

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  const n = Math.floor(limit);
  if (n < 1) return 1;
  if (n > MAX_LIMIT) return MAX_LIMIT;
  return n;
}

// Pick the drivers to run. Default: all. A caller can restrict via input.sources (unknown
// names are ignored — a typo never runs a driver we don't have). Order is stable (registry
// order) so coverage output is reproducible.
function selectDrivers(sources: string[] | undefined): IngestDriver[] {
  if (!sources || sources.length === 0) return [...DRIVERS];
  const wanted = new Set(sources.map((s) => s.trim().toLowerCase()).filter(Boolean));
  return DRIVERS.filter((d) => wanted.has(d.sourceType.toLowerCase()));
}

// Build the driver context from the pipeline input. Trims + null-normalizes so drivers
// never receive an empty-string "value".
function buildContext(pool: Pool, input: IngestInput, limit: number): DriverContext {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  return {
    query: query.length > 0 ? query : null,
    entitySurface: normalize(input.entity?.surface),
    entityCurie: normalize(input.entity?.curie),
    entityType: normalize(input.entity?.type),
    limit,
    pool,
  };
}

function normalize(v: string | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

// ---------------------------------------------------------------------------
// Cache lookup: which of these (source_type, external_id) keys are ALREADY in `sources`.
// One parameterized round-trip via unnest so a key from one source can't cross-match
// another. Returns a map key -> row id for reuse.
// ---------------------------------------------------------------------------

function cacheKey(sourceType: string, externalId: string): string {
  return `${sourceType}\u0000${externalId}`;
}

async function lookupCached(
  pool: Pool,
  records: readonly CacheableSourceRecord[]
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (records.length === 0) return found;

  const types = records.map((r) => r.source_type);
  const ids = records.map((r) => r.external_id);

  try {
    const { rows } = await pool.query<{
      id: string;
      source_type: string;
      external_id: string;
    }>(
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
  } catch {
    // DB blip — treat everything as uncached (the upsert's on-conflict still protects
    // against a duplicate). Never throws out of the pipeline.
  }
  return found;
}

// ---------------------------------------------------------------------------
// Insert one NEW record: embed its text, upsert via the same on-conflict shape as
// searchAndCache.upsertRow, and write the additive provenance columns. Returns the row id
// (or null on failure). Embedding failures degrade to a null-embedding insert so the
// cached text is still available for the demo even without a vector.
// ---------------------------------------------------------------------------

async function insertRecord(
  pool: Pool,
  record: CacheableSourceRecord,
  snapshotId: string
): Promise<string | null> {
  const embedding = await embed(record.raw_text).catch(() => null);
  const vectorLiteral = embedding ? toPgVectorLiteral(embedding) : null;

  try {
    const { rows } = await pool.query<{ id: string }>(
      `insert into sources
         (source_type, external_id, title, raw_text, url,
          variant_id, compound_id, adverse_event_cui,
          source_snapshot_id, source_version, snapshot_date, embedding)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(),
               case when $11::text is null then null else $11::vector end)
       on conflict (source_type, external_id) do update
         set raw_text = excluded.raw_text,
             title = excluded.title,
             url = excluded.url,
             variant_id = coalesce(excluded.variant_id, sources.variant_id),
             compound_id = coalesce(excluded.compound_id, sources.compound_id),
             adverse_event_cui = coalesce(excluded.adverse_event_cui, sources.adverse_event_cui),
             source_snapshot_id = excluded.source_snapshot_id,
             source_version = coalesce(excluded.source_version, sources.source_version),
             snapshot_date = now(),
             embedding = coalesce(excluded.embedding, sources.embedding)
       returning id`,
      [
        record.source_type,
        record.external_id,
        record.title,
        record.raw_text,
        record.url,
        record.metadata.variantId ?? null,
        record.metadata.compoundId ?? null,
        record.metadata.adverseEventCui ?? null,
        snapshotId,
        record.metadata.sourceVersion ?? null,
        vectorLiteral,
      ]
    );
    return rows[0]?.id ?? null;
  } catch {
    // A single bad record (schema gap, constraint) must not sink the batch.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Process one driver's records: cache-once each, insert the new ones, record provenance,
// and canonicalize each NEW source's text into document_entities. Mutates nothing shared;
// returns per-record results + a dropped-ungrounded tally for this driver.
// ---------------------------------------------------------------------------

interface DriverOutcome {
  results: SourceIngestResult[];
  droppedUngrounded: number;
}

async function processRecords(
  pool: Pool,
  records: CacheableSourceRecord[]
): Promise<DriverOutcome> {
  // Drop degenerate records before spending any DB/embedding budget.
  const usable = records.filter(
    (r) =>
      typeof r.raw_text === "string" &&
      r.raw_text.trim().length >= MIN_RAW_TEXT_LENGTH &&
      r.external_id.trim().length > 0
  );

  const cached = await lookupCached(pool, usable);

  const results: SourceIngestResult[] = [];
  let droppedUngrounded = 0;

  for (const record of usable) {
    const key = cacheKey(record.source_type, record.external_id);
    const existingId = cached.get(key);

    // CACHE-ONCE: an already-cached (source_type, external_id) is reused verbatim. We do
    // NOT re-embed, re-insert, or re-canonicalize — the whole point of the cache rule.
    if (existingId) {
      results.push({
        source_type: record.source_type,
        external_id: record.external_id,
        cached: true,
        entitiesLinked: 0,
      });
      continue;
    }

    const snapshotId = computeSnapshotId(snapshotContentFor(record));
    const rowId = await insertRecord(pool, record, snapshotId);
    if (!rowId) {
      // Insert failed — nothing cached, so don't record a phantom success.
      continue;
    }

    // PROVENANCE: append the access log + stamp version/snapshot. Best-effort.
    await recordAccess(pool, {
      source_type: record.source_type,
      external_id: record.external_id,
      license: record.metadata.license ?? null,
      snapshotId,
      sourceVersion: record.metadata.sourceVersion ?? null,
    });

    // VERSION LEDGER: append an immutable evidence_source_versions row so the Later-tier
    // chain-of-custody resolves a real content_hash + version + doi/pmid for this source.
    // pubmed external_ids are PMIDs; a driver may carry a doi in metadata. Best-effort.
    await recordSourceVersion(pool, {
      sourceId: rowId,
      contentHash: snapshotId,
      sourceVersion: record.metadata.sourceVersion ?? null,
      doi: typeof record.metadata.doi === "string" ? record.metadata.doi : null,
      pmid: record.source_type === "pubmed" ? record.external_id : null,
    });

    // ENTITY CANONICALIZATION: only for NEW source text. NER (Claude) -> deterministic
    // resolveMany -> document_entities. A failure degrades to zero linked entities rather
    // than sinking the ingest of the (already-cached) row.
    const { linked, dropped } = await canonicalizeSafely(pool, rowId, record.raw_text);
    droppedUngrounded += dropped;

    results.push({
      source_type: record.source_type,
      external_id: record.external_id,
      cached: false,
      entitiesLinked: linked,
    });
  }

  return { results, droppedUngrounded };
}

// Wrap canonicalizeSourceEntities so any failure (LLM outage, DB gap) is honest-empty and
// never throws out of the pipeline. Returns linked + dropped counts.
async function canonicalizeSafely(
  pool: Pool,
  sourceId: string,
  text: string
): Promise<{ linked: number; dropped: number }> {
  try {
    const { entities, dropped } = await canonicalizeSourceEntities(pool, sourceId, text);
    return { linked: entities.length, dropped };
  } catch {
    return { linked: 0, dropped: 0 };
  }
}

// ---------------------------------------------------------------------------
// runMultiSourceIngest — the public entry point (SHARED CONTRACT).
// ---------------------------------------------------------------------------

export async function runMultiSourceIngest(
  pool: Pool,
  input: IngestInput
): Promise<MultiSourceIngestResult> {
  const limit = clampLimit(input.limit);
  const drivers = selectDrivers(input.sources);
  const context = buildContext(pool, input, limit);

  // Nothing to key a lookup on → honest empty result (no fabricated ingest).
  if (!context.query && !context.entitySurface && !context.entityCurie) {
    return { ingested: [], coverage: {}, droppedUngrounded: 0 };
  }

  const ingested: SourceIngestResult[] = [];
  const coverage: Record<string, number> = {};
  let droppedUngrounded = 0;

  // Run drivers in parallel (independent upstream APIs); each driver's failure is isolated
  // to itself (fetch already catches, but we guard again so one throw can't sink the fan).
  const driverRecords = await Promise.all(
    drivers.map(async (driver) => {
      const records = await driver.fetch(context).catch(() => [] as CacheableSourceRecord[]);
      return { sourceType: driver.sourceType, records };
    })
  );

  for (const { sourceType, records } of driverRecords) {
    // Initialize coverage for every selected driver, even one that returned nothing, so
    // the caller sees an explicit 0 rather than a missing key.
    if (!(sourceType in coverage)) coverage[sourceType] = 0;

    const outcome = await processRecords(pool, records);
    for (const result of outcome.results) {
      ingested.push(result);
      coverage[result.source_type] = (coverage[result.source_type] ?? 0) + 1;
    }
    droppedUngrounded += outcome.droppedUngrounded;
  }

  return { ingested, coverage, droppedUngrounded };
}
