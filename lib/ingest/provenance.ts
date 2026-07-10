import { createHash } from "crypto";
import type { Pool } from "pg";

// PER-SOURCE PROVENANCE for the multi-source ingest pipeline.
//
// Every cached source row must carry an auditable trail: WHICH database it came from,
// WHICH version/snapshot of that database we drew it from, under WHAT license, and WHEN
// it was accessed. `recordAccess` writes an append-only `source_access_log` row AND
// stamps `source_version` / `snapshot_date` onto the owning `sources` row so a downstream
// export can reconstruct exact provenance without a live re-fetch (CLAUDE.md cache-every-
// thing: the demo never depends on live latency).
//
// MOAT: the snapshot id is DETERMINISTIC — a content hash of (source_type + external_id +
// the record's stable, DATE-LESS content). The SAME source content always hashes to the
// SAME snapshot id, so re-ingesting an unchanged record is a no-op and two ingests of the
// same public record agree. We deliberately do NOT fold Date.now() (or any wall-clock
// value) into the hash — that would make the snapshot id non-reproducible and break
// cache-once. The access TIMESTAMP is recorded separately (in its own column), not hashed.
//
// Nothing here logs raw source/claim text — only ids/counts/hashes.

// Field separator for the hash input: a NUL that cannot appear in the printable content
// fields, so distinct field layouts can't collide by concatenation.
const FIELD_SEP = "\u0000";

// The stable, DATE-LESS content we hash into a snapshot id. Callers pass the immutable
// identity + payload of a record; excluding any timestamp keeps the hash reproducible.
export interface SnapshotContent {
  source_type: string;
  external_id: string;
  // The record's canonical content — title + raw_text + url + a stable metadata digest.
  // Whatever the driver considers the "body" of the source. Never a timestamp.
  content: string;
}

// A recordAccess request. `license` + `snapshotId` are optional so a caller that hasn't
// computed a snapshot id can still log an access (the id is then derived as null on the
// sources row rather than fabricated).
export interface RecordAccessInput {
  source_type: string;
  external_id: string;
  license?: string | null;
  snapshotId?: string | null;
  // The database version string (e.g. "ChEMBL_34", "ClinVar 2026-07"), when the driver
  // knows it. Stamped onto sources.source_version. Optional — null when unknown.
  sourceVersion?: string | null;
}

// ---------------------------------------------------------------------------
// computeSnapshotId — a deterministic SHA-256 (hex) over the date-less content. Same
// content → same id, forever. This is the value stamped as sources.source_snapshot_id
// and logged as source_access_log.snapshot_id, so an auditor can prove two rows describe
// the identical upstream snapshot. NO wall-clock input.
// ---------------------------------------------------------------------------

export function computeSnapshotId(content: SnapshotContent): string {
  const canonical = [
    content.source_type,
    content.external_id,
    content.content,
  ].join(FIELD_SEP);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// Build the stable content string a driver hashes from a cacheable source record. Pulls
// only immutable fields (title, raw_text, url, and a sorted metadata digest) — never a
// timestamp — so the snapshot id is reproducible across ingests.
export function snapshotContentFor(record: {
  source_type: string;
  external_id: string;
  title?: string | null;
  raw_text: string;
  url?: string | null;
  metadata?: Record<string, unknown> | null;
}): SnapshotContent {
  const metaDigest = record.metadata ? stableStringify(record.metadata) : "";
  return {
    source_type: record.source_type,
    external_id: record.external_id,
    content: [
      record.title ?? "",
      record.raw_text,
      record.url ?? "",
      metaDigest,
    ].join(FIELD_SEP),
  };
}

// Deterministic JSON serialization: keys sorted recursively so an object hashes the same
// regardless of key insertion order. Pure — never mutates the input.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`)
    .join(",");
  return `{${body}}`;
}

// ---------------------------------------------------------------------------
// recordAccess — append an access-log row AND stamp version/snapshot onto the sources
// row. Both writes are best-effort and independently guarded: a provenance write must
// NEVER sink an ingest (the source is already cached; losing a log line is recoverable,
// losing the cached row is not). Returns whether each write succeeded, for the caller's
// telemetry — but the caller ignores it on the happy path.
// ---------------------------------------------------------------------------

export interface RecordAccessResult {
  logged: boolean;
  stamped: boolean;
}

export async function recordAccess(
  pool: Pool,
  input: RecordAccessInput
): Promise<RecordAccessResult> {
  const sourceType = input.source_type.trim();
  const externalId = input.external_id.trim();
  if (sourceType.length === 0 || externalId.length === 0) {
    return { logged: false, stamped: false };
  }

  const license = normalizeOptional(input.license);
  const snapshotId = normalizeOptional(input.snapshotId);
  const sourceVersion = normalizeOptional(input.sourceVersion);

  const logged = await appendAccessLog(pool, {
    sourceType,
    externalId,
    license,
    snapshotId,
  });
  const stamped = await stampSourceProvenance(pool, {
    sourceType,
    externalId,
    snapshotId,
    sourceVersion,
  });

  return { logged, stamped };
}

function normalizeOptional(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

// ---------------------------------------------------------------------------
// recordSourceVersion — append a row to the immutable `evidence_source_versions` ledger
// (migration 0067) for a newly-cached source, so the Later-tier chain-of-custody
// (lib/provenance/chainOfCustody.ts) resolves a real content_hash + version + doi/pmid
// per source instead of falling back to source-derived defaults. Append-only, best-effort:
// a failure NEVER sinks an ingest (the source is already cached). Called once per NEW
// cached record (the pipeline skips already-cached rows before this point, so no dup risk).
// ---------------------------------------------------------------------------

export interface RecordVersionInput {
  sourceId: string;
  contentHash: string; // the deterministic snapshot id (sha256 of date-less content)
  sourceVersion?: string | null;
  doi?: string | null;
  pmid?: string | null;
}

export async function recordSourceVersion(
  pool: Pool,
  input: RecordVersionInput
): Promise<boolean> {
  const sourceId = input.sourceId.trim();
  if (sourceId.length === 0) return false;
  try {
    await pool.query(
      `insert into evidence_source_versions
         (source_id, source_version, snapshot_date, doi, pmid, content_hash)
       values ($1, $2, now(), $3, $4, $5)`,
      [
        sourceId,
        normalizeOptional(input.sourceVersion),
        normalizeOptional(input.doi),
        normalizeOptional(input.pmid),
        normalizeOptional(input.contentHash),
      ]
    );
    return true;
  } catch {
    // Table not yet migrated / DB blip — non-fatal; the cached source is unaffected.
    return false;
  }
}

// Append-only provenance log. `accessed_at` defaults in-DB (now()) — the ONLY place a
// wall-clock value enters provenance, and it is a separate column, never the hash input.
async function appendAccessLog(
  pool: Pool,
  row: {
    sourceType: string;
    externalId: string;
    license: string | null;
    snapshotId: string | null;
  }
): Promise<boolean> {
  try {
    await pool.query(
      `insert into source_access_log (source_type, external_id, license, snapshot_id)
       values ($1, $2, $3, $4)`,
      [row.sourceType, row.externalId, row.license, row.snapshotId]
    );
    return true;
  } catch {
    // Table missing / DB blip — non-fatal. The cached source is unaffected.
    return false;
  }
}

// Stamp the deterministic snapshot id + version onto the owning sources row. Uses
// coalesce so a subsequent access with a null version/snapshot never clobbers a value we
// already recorded (provenance is monotonic — we don't erase a known version with null).
// snapshot_date is set to now() at stamp time (a wall-clock value that is NOT hashed).
async function stampSourceProvenance(
  pool: Pool,
  row: {
    sourceType: string;
    externalId: string;
    snapshotId: string | null;
    sourceVersion: string | null;
  }
): Promise<boolean> {
  try {
    await pool.query(
      `update sources
          set source_snapshot_id = coalesce($3, source_snapshot_id),
              source_version     = coalesce($4, source_version),
              snapshot_date      = now()
        where source_type = $1 and external_id = $2`,
      [row.sourceType, row.externalId, row.snapshotId, row.sourceVersion]
    );
    return true;
  } catch {
    // Columns not yet migrated / DB blip — non-fatal.
    return false;
  }
}
