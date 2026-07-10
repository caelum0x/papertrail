import type { Pool } from "pg";
import { canonicalize, sha256Hex } from "@/lib/compliance/hash";
import { locateSpan } from "@/lib/grounding";
import type { FlaggedSpan } from "@/lib/schemas";

// IMMUTABLE PROVENANCE / CHAIN OF CUSTODY (21 CFR Part 11-grade).
//
// buildChainOfCustody() reconstructs, for one stored verification, the EXACT
// provenance state of every grounded span: which source it came from, the source's
// external identifiers (doi/pmid), which snapshot VERSION of that source was in
// effect, and a deterministic chain-of-custody hash over that ordered tuple.
//
// Moat rules honored here:
//  - No LLM, no scoring, no verdict logic — this is pure deterministic assembly.
//  - Every span is RE-GROUNDED against the current cached source text via
//    locateSpan(); a span that no longer maps to a verbatim substring is DROPPED
//    and counted (ungroundable == unsourced, and PaperTrail never asserts one).
//  - The hash is a sha256 over a canonical (key-sorted) JSON tuple with NO
//    Date.now / wall-clock input, so re-running the build over unchanged state
//    yields byte-identical hashes (tamper-evident + reproducible for export).

/** External identifiers resolved for a source, honestly nullable. */
export interface SourceIdentifiers {
  doi: string | null;
  pmid: string | null;
}

/** One grounded span with its full, hashable provenance tuple. */
export interface ChainOfCustodyRecord {
  verification_id: string;
  source_id: string;
  doi: string | null;
  pmid: string | null;
  source_version: string | null;
  snapshot_date: string | null;
  content_hash: string | null;
  /** The verbatim source substring located at export time. */
  source_span: string;
  /** Char offsets into the current cached source raw_text. */
  span_start: number;
  span_end: number;
  /** Deterministic sha256 over the ordered provenance tuple (no wall-clock input). */
  chain_of_custody_hash: string;
}

/** The full custody assembly for one verification. */
export interface ChainOfCustody {
  verification_id: string;
  source_id: string | null;
  source_version: string | null;
  snapshot_date: string | null;
  content_hash: string | null;
  doi: string | null;
  pmid: string | null;
  records: ChainOfCustodyRecord[];
  /** Spans that could no longer be grounded against the current source text. */
  dropped_ungroundable: number;
  /** A single deterministic hash over the ordered per-span custody hashes. */
  aggregate_hash: string;
}

// The verification joined to its matched source. matched_source_id / raw_text may
// be null (source removed, or a no_support_found verdict with no matched source).
interface VerificationCustodyRow {
  verification_id: string;
  matched_source_id: string | null;
  flagged_spans: FlaggedSpan[] | null;
  source_type: string | null;
  external_id: string | null;
  raw_text: string | null;
}

interface SourceVersionRow {
  source_version: string | null;
  snapshot_date: Date | string | null;
  doi: string | null;
  pmid: string | null;
  content_hash: string | null;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

// Resolve external identifiers from the source row itself. A PubMed source's
// external_id IS its PMID; ClinicalTrials.gov ids are neither doi nor pmid. The
// version ledger may carry a more precise doi/pmid, which takes precedence.
function identifiersFromSource(
  sourceType: string | null,
  externalId: string | null
): SourceIdentifiers {
  if (sourceType === "pubmed" && externalId) {
    return { doi: null, pmid: externalId };
  }
  return { doi: null, pmid: null };
}

// The deterministic provenance tuple. Field order is fixed and canonicalize()
// sorts keys, so the same logical state always hashes identically. Deliberately
// contains NO wall-clock value.
function computeCustodyHash(input: {
  verification_id: string;
  source_id: string;
  doi: string | null;
  pmid: string | null;
  source_version: string | null;
  snapshot_date: string | null;
  content_hash: string | null;
  source_span: string;
  span_start: number;
  span_end: number;
}): string {
  return sha256Hex(canonicalize(input));
}

async function loadVerificationRow(
  pool: Pool,
  verificationId: string
): Promise<VerificationCustodyRow | null> {
  const { rows } = await pool.query<VerificationCustodyRow>(
    `select
       v.id            as verification_id,
       v.matched_source_id,
       v.flagged_spans,
       s.source_type,
       s.external_id,
       s.raw_text
     from verifications v
     left join sources s on v.matched_source_id = s.id
     where v.id = $1`,
    [verificationId]
  );
  return rows[0] ?? null;
}

// Latest snapshot version for a source. "Latest" = highest snapshot_date, then
// most recently recorded — deterministic given the ledger contents.
async function loadLatestVersion(
  pool: Pool,
  sourceId: string
): Promise<SourceVersionRow | null> {
  const { rows } = await pool.query<SourceVersionRow>(
    `select source_version, snapshot_date, doi, pmid, content_hash
       from evidence_source_versions
      where source_id = $1
      order by snapshot_date desc nulls last, recorded_at desc
      limit 1`,
    [sourceId]
  );
  return rows[0] ?? null;
}

/**
 * Assemble the chain of custody for a single verification. Returns null when the
 * verification does not exist. When the source is missing (raw_text null) or the
 * verdict had no matched source, `records` is empty and identifiers are null —
 * we never fabricate provenance we cannot ground.
 */
export async function buildChainOfCustody(
  pool: Pool,
  verificationId: string
): Promise<ChainOfCustody | null> {
  const row = await loadVerificationRow(pool, verificationId);
  if (!row) {
    return null;
  }

  const sourceId = row.matched_source_id;
  const rawText = row.raw_text;
  const storedSpans = row.flagged_spans ?? [];

  // No groundable source -> honest, empty custody envelope (still hashed).
  if (!sourceId || rawText === null) {
    const aggregate_hash = sha256Hex(
      canonicalize({ verification_id: verificationId, records: [] as string[] })
    );
    return {
      verification_id: verificationId,
      source_id: sourceId,
      source_version: null,
      snapshot_date: null,
      content_hash: null,
      doi: null,
      pmid: null,
      records: [],
      dropped_ungroundable: storedSpans.length,
      aggregate_hash,
    };
  }

  const version = await loadLatestVersion(pool, sourceId);
  const fallbackIds = identifiersFromSource(row.source_type, row.external_id);
  const doi = version?.doi ?? fallbackIds.doi;
  const pmid = version?.pmid ?? fallbackIds.pmid;
  const sourceVersion = version?.source_version ?? null;
  const snapshotDate = toIso(version?.snapshot_date ?? null);
  const contentHash = version?.content_hash ?? null;

  const records: ChainOfCustodyRecord[] = [];
  let dropped = 0;

  for (const span of storedSpans) {
    const located = locateSpan(rawText, span.source_span);
    if (!located) {
      dropped += 1;
      continue;
    }
    const chain_of_custody_hash = computeCustodyHash({
      verification_id: verificationId,
      source_id: sourceId,
      doi,
      pmid,
      source_version: sourceVersion,
      snapshot_date: snapshotDate,
      content_hash: contentHash,
      source_span: located.text,
      span_start: located.start,
      span_end: located.end,
    });
    records.push({
      verification_id: verificationId,
      source_id: sourceId,
      doi,
      pmid,
      source_version: sourceVersion,
      snapshot_date: snapshotDate,
      content_hash: contentHash,
      source_span: located.text,
      span_start: located.start,
      span_end: located.end,
      chain_of_custody_hash,
    });
  }

  const aggregate_hash = sha256Hex(
    canonicalize({
      verification_id: verificationId,
      records: records.map((r) => r.chain_of_custody_hash),
    })
  );

  return {
    verification_id: verificationId,
    source_id: sourceId,
    source_version: sourceVersion,
    snapshot_date: snapshotDate,
    content_hash: contentHash,
    doi,
    pmid,
    records,
    dropped_ungroundable: dropped,
    aggregate_hash,
  };
}
