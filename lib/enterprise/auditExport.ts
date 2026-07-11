import type { Pool } from "pg";
import { verifyChain } from "@/lib/compliance/chain";
import {
  canonicalize,
  computeEntryHash,
  sha256Hex,
  GENESIS_PREV_HASH,
} from "@/lib/compliance/hash";
import type {
  AuditChainEntry,
  ChainVerification,
} from "@/lib/compliance/types";

// ---------------------------------------------------------------------------
// ENTERPRISE IMMUTABLE AUDIT EXPORT
//
// assembleAuditExport() composes a self-verifying export of an org's WORM audit
// chain (the `audit_chain` rows appended by lib/compliance/chain.ts). The export
// is:
//
//   * Deterministic — no wall-clock input enters the hashed body. The same
//     underlying chain always produces the same `export_hash`. `generated_at`
//     is recorded for humans but is EXCLUDED from the hash, so re-exporting an
//     unchanged chain is byte-identical under the hash.
//   * Verifiable — every exported entry carries the fields needed to recompute
//     its own hash (`prev_hash` + canonical `event`), and each entry's
//     `recomputed_hash`/`hash_matches` are included so a downstream auditor can
//     confirm integrity without trusting us. The top-level `chain_verification`
//     is the authoritative end-to-end verifyChain() result.
//   * Honest about gaps — instead of silently trusting the ledger, the export
//     independently re-walks the entries and lists every integrity gap
//     (non-contiguous seq, broken linkage, tampered event) it finds. An export
//     over a broken chain is still produced, but the break is surfaced, not
//     hidden. Optional [from, to] windowing narrows the exported rows; when a
//     window is applied, `coverage.windowed` is true and the pre/post entries
//     are counted so a reviewer knows the export is a slice, not the whole chain.
//
// Moat rules honored: NO LLM anywhere — pure deterministic assembly + the
// existing sha256 hash primitives. Never logs claim/patient/source text; the
// exported `event` payloads are the org's own already-sanitized audit events
// (ids/hashes/counts), and this module adds no text of its own.
//
// All SQL is parameterized and org-scoped (org_id = $1). The org id is resolved
// server-side by the route (ctx.org.id) and never client-asserted.
// ---------------------------------------------------------------------------

interface AuditChainRow {
  id: string;
  org_id: string;
  seq: string | number;
  prev_hash: string;
  entry_hash: string;
  event: Record<string, unknown> | null;
  created_at: string | Date;
}

function mapRow(row: AuditChainRow): AuditChainEntry {
  return {
    id: row.id,
    org_id: row.org_id,
    seq: Number(row.seq),
    prev_hash: row.prev_hash,
    entry_hash: row.entry_hash,
    event: row.event ?? {},
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

/** Optional inclusive time window (ISO 8601) to narrow the exported rows. */
export interface AuditExportWindow {
  from?: string;
  to?: string;
}

/** One exported audit entry, augmented with a self-contained integrity proof. */
export interface AuditExportEntry {
  id: string;
  seq: number;
  prev_hash: string;
  entry_hash: string;
  /** The hash recomputed from prev_hash + canonical(event) at export time. */
  recomputed_hash: string;
  /** Whether the stored entry_hash equals the recomputed hash. */
  hash_matches: boolean;
  event: Record<string, unknown>;
  created_at: string;
}

/** A single integrity gap discovered while re-walking the exported entries. */
export interface AuditExportGap {
  seq: number;
  kind: "non_contiguous_seq" | "broken_linkage" | "tampered_event";
  detail: string;
}

/** Coverage summary: what the export does and does not include, honestly. */
export interface AuditExportCoverage {
  /** Rows included in this export (after any windowing). */
  exported_entries: number;
  /** Total rows in the org's chain, regardless of the window. */
  total_chain_entries: number;
  /** True when a from/to window was applied and excluded some rows. */
  windowed: boolean;
  /** Chain entries with seq below the exported window (excluded). */
  entries_before_window: number;
  /** Chain entries with seq above the exported window (excluded). */
  entries_after_window: number;
  /** Seq of the first exported entry, or null when the export is empty. */
  first_seq: number | null;
  /** Seq of the last exported entry, or null when the export is empty. */
  last_seq: number | null;
  /** created_at of the first exported entry, or null when empty. */
  first_at: string | null;
  /** created_at of the last exported entry, or null when empty. */
  last_at: string | null;
  /** The requested window echoed back (nulls when unbounded). */
  window: { from: string | null; to: string | null };
}

/**
 * The canonical, hashable body of the export. `export_hash` is sha256 over
 * canonicalize(this), so it excludes `generated_at` by construction. Every field
 * here is deterministic given the underlying chain rows.
 */
export interface AuditExportBody {
  format_version: 1;
  org_id: string;
  /** Authoritative end-to-end verification of the WHOLE chain (not just window). */
  chain_verification: ChainVerification;
  coverage: AuditExportCoverage;
  entries: AuditExportEntry[];
  /** Integrity gaps found while re-walking the exported entries; [] when clean. */
  gaps: AuditExportGap[];
}

/** The full export envelope returned to the caller / downloaded as JSON. */
export interface AuditExport extends AuditExportBody {
  /** sha256 over canonicalize(body) — deterministic, excludes generated_at. */
  export_hash: string;
  /** Wall-clock stamp for humans. NOT part of export_hash. */
  generated_at: string;
}

// Load the org's audit chain in seq order (oldest first) so linkage can be
// re-walked. Parameterized + org-scoped. We select the full row (including
// prev_hash + event) because the export must be independently verifiable.
async function loadChainRows(
  pool: Pool,
  orgId: string
): Promise<AuditChainEntry[]> {
  const { rows } = await pool.query<AuditChainRow>(
    `select id, org_id, seq, prev_hash, entry_hash, event, created_at
       from audit_chain
      where org_id = $1
      order by seq asc`,
    [orgId]
  );
  return rows.map(mapRow);
}

// True when the entry's created_at falls within the inclusive window. An absent
// bound is treated as unbounded on that side. Invalid bound strings are ignored
// (treated as unbounded) so a bad query param can never silently drop rows.
function inWindow(
  entry: AuditChainEntry,
  fromMs: number | null,
  toMs: number | null
): boolean {
  const at = Date.parse(entry.created_at);
  if (Number.isNaN(at)) {
    return true;
  }
  if (fromMs !== null && at < fromMs) {
    return false;
  }
  if (toMs !== null && at > toMs) {
    return false;
  }
  return true;
}

function parseBound(value: string | undefined): number | null {
  if (value === undefined || value === "") {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

// Re-walk the exported (windowed) entries independently of the DB's stored
// linkage to surface integrity gaps. When the export is windowed the first
// entry's prev_hash intentionally links to a row OUTSIDE the window, so linkage
// checking begins from the second entry; contiguity and per-entry hash checks
// still apply to every exported row.
function detectGaps(entries: readonly AuditExportEntry[]): AuditExportGap[] {
  const gaps: AuditExportGap[] = [];
  let previous: AuditExportEntry | null = null;

  for (const entry of entries) {
    if (previous !== null) {
      if (entry.seq !== previous.seq + 1) {
        gaps.push({
          seq: entry.seq,
          kind: "non_contiguous_seq",
          detail: `Expected seq ${previous.seq + 1}, found ${entry.seq}.`,
        });
      }
      if (entry.prev_hash !== previous.entry_hash) {
        gaps.push({
          seq: entry.seq,
          kind: "broken_linkage",
          detail: `prev_hash at seq ${entry.seq} does not match the prior entry's entry_hash.`,
        });
      }
    }
    if (!entry.hash_matches) {
      gaps.push({
        seq: entry.seq,
        kind: "tampered_event",
        detail: `Recomputed hash at seq ${entry.seq} does not match the stored entry_hash.`,
      });
    }
    previous = entry;
  }

  return gaps;
}

// Build the per-entry export view, recomputing each hash so the entry carries
// its own integrity proof. Deterministic: computeEntryHash has no wall-clock.
function toExportEntry(entry: AuditChainEntry): AuditExportEntry {
  const recomputed = computeEntryHash(entry.prev_hash, entry.event);
  return {
    id: entry.id,
    seq: entry.seq,
    prev_hash: entry.prev_hash,
    entry_hash: entry.entry_hash,
    recomputed_hash: recomputed,
    hash_matches: recomputed === entry.entry_hash,
    event: entry.event,
    created_at: entry.created_at,
  };
}

/**
 * Assemble an immutable, verifiable audit export for one org.
 *
 * @param pool  DB pool (parameterized, org-scoped queries only).
 * @param orgId The org whose chain to export (resolved server-side).
 * @param win   Optional inclusive created_at window; invalid bounds are ignored.
 *
 * Deterministic and side-effect-free: it reads the chain and composes the export.
 * The returned `export_hash` is stable for a fixed chain state; only
 * `generated_at` varies between runs and it is excluded from the hash.
 */
export async function assembleAuditExport(
  pool: Pool,
  orgId: string,
  win: AuditExportWindow = {}
): Promise<AuditExport> {
  // Authoritative whole-chain verification via the existing primitive. This is
  // the source of truth for "is this org's ledger intact end-to-end".
  const chainVerification = await verifyChain(orgId, pool);

  const allEntries = await loadChainRows(pool, orgId);

  const fromMs = parseBound(win.from);
  const toMs = parseBound(win.to);
  const windowed = fromMs !== null || toMs !== null;

  const exportedEntries: AuditExportEntry[] = [];
  let entriesBefore = 0;
  let entriesAfter = 0;

  for (const entry of allEntries) {
    if (!windowed || inWindow(entry, fromMs, toMs)) {
      exportedEntries.push(toExportEntry(entry));
      continue;
    }
    const at = Date.parse(entry.created_at);
    if (fromMs !== null && !Number.isNaN(at) && at < fromMs) {
      entriesBefore += 1;
    } else {
      entriesAfter += 1;
    }
  }

  const first = exportedEntries[0] ?? null;
  const last =
    exportedEntries.length > 0
      ? exportedEntries[exportedEntries.length - 1]
      : null;

  const coverage: AuditExportCoverage = {
    exported_entries: exportedEntries.length,
    total_chain_entries: allEntries.length,
    windowed,
    entries_before_window: entriesBefore,
    entries_after_window: entriesAfter,
    first_seq: first?.seq ?? null,
    last_seq: last?.seq ?? null,
    first_at: first?.created_at ?? null,
    last_at: last?.created_at ?? null,
    window: {
      from: fromMs !== null ? win.from ?? null : null,
      to: toMs !== null ? win.to ?? null : null,
    },
  };

  const gaps = detectGaps(exportedEntries);

  const body: AuditExportBody = {
    format_version: 1,
    org_id: orgId,
    chain_verification: chainVerification,
    coverage,
    entries: exportedEntries,
    gaps,
  };

  // export_hash is over the canonical body ONLY — generated_at is added after
  // hashing so it never perturbs the deterministic digest.
  const export_hash = sha256Hex(canonicalize(body));

  return {
    ...body,
    export_hash,
    generated_at: new Date().toISOString(),
  };
}

// Re-exported so downstream verifiers can reference the genesis seed without a
// second import from the hash module.
export { GENESIS_PREV_HASH };
