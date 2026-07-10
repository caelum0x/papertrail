import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import { appendToChain } from "@/lib/compliance/chain";
import {
  DEFAULT_THRESHOLDS,
  runAllDetectors,
  type DetectionThresholds,
  type SecurityEventCandidate,
  type SecurityEventKind,
  type SecuritySeverity,
} from "@/lib/security/threatDetection";

// ---------------------------------------------------------------------------
// Security scan orchestration. runOrgSecurityScan runs the deterministic
// detectors (threatDetection.ts) for one org, persists genuinely-NEW findings
// into security_events, and escalates high/critical findings onto the org's
// WORM audit chain (lib/compliance/chain.ts) so they are tamper-evident.
//
// Dedup: a standing condition (e.g. the same key still triggering the same
// detector on the next sweep) must not spam the feed. A candidate is persisted
// only if no row of the same (org_id, kind) — narrowed to the same primary
// subject id where the detector has one — exists within the dedup window.
//
// Best-effort chain append: a failure to append the audit-chain entry must not
// lose the security_events row that was already written, so the append is
// wrapped in its own try/catch and only logged as a count.
// ---------------------------------------------------------------------------

// Severities that warrant a tamper-evident audit-chain entry.
const CHAIN_SEVERITIES: ReadonlySet<SecuritySeverity> = new Set<SecuritySeverity>(
  ["high", "critical"]
);

export interface ScanResult {
  orgId: string;
  detected: number;
  persisted: number;
  chained: number;
}

// Minutes back within which an identical finding is considered a duplicate of
// one already on record. Slightly longer than the detection window so a
// standing condition observed on consecutive sweeps is not re-emitted.
const DEDUP_WINDOW_MINUTES = 120;

interface ExistsRow {
  exists: boolean;
}

// The stable subject id a detector attaches to a finding (an api key id), used
// to make dedup precise: two findings of the same kind about different keys are
// distinct events. Falls back to kind-only dedup when a detector has no subject.
function subjectId(candidate: SecurityEventCandidate): string | null {
  const raw = candidate.detail["apiKeyId"];
  return typeof raw === "string" ? raw : null;
}

// True if an equivalent finding already exists within the dedup window. Matches
// on (org_id, kind) and, when the candidate has a subject id, on that same id
// inside the detail jsonb so per-key findings dedup independently.
async function isDuplicate(
  pool: Pool,
  orgId: string,
  candidate: SecurityEventCandidate
): Promise<boolean> {
  const subject = subjectId(candidate);
  const params: unknown[] = [orgId, candidate.kind, DEDUP_WINDOW_MINUTES];
  let subjectClause = "";
  if (subject !== null) {
    params.push(subject);
    subjectClause = ` and detail ->> 'apiKeyId' = $${params.length}`;
  }
  const { rows } = await pool.query<ExistsRow>(
    `select exists (
        select 1
          from security_events
         where org_id = $1
           and kind = $2
           and detected_at >= now() - ($3::int || ' minutes')::interval
           ${subjectClause}
     ) as exists`,
    params
  );
  return rows[0]?.exists === true;
}

interface InsertedRow {
  id: string;
}

// Inserts a single finding, returning its new id. Parameterized; detail is
// serialized to jsonb. source_ip is stored verbatim (nullable) — the detectors
// only ever put a coarse network identifier here, never user identity.
async function insertEvent(
  pool: Pool,
  orgId: string,
  candidate: SecurityEventCandidate
): Promise<string> {
  const { rows } = await pool.query<InsertedRow>(
    `insert into security_events (org_id, kind, severity, detail, source_ip)
     values ($1, $2, $3, $4::jsonb, $5)
     returning id`,
    [
      orgId,
      candidate.kind,
      candidate.severity,
      JSON.stringify(candidate.detail),
      candidate.sourceIp,
    ]
  );
  return rows[0].id;
}

// Appends a tamper-evident record of a high-severity finding to the org's WORM
// chain. The event payload carries only ids/counts/severity — never raw text.
// Best-effort: never throws, so a chain hiccup cannot lose the persisted row.
async function chainHighSeverity(
  orgId: string,
  eventId: string,
  candidate: SecurityEventCandidate
): Promise<boolean> {
  try {
    await appendToChain(orgId, {
      type: "security_event",
      kind: candidate.kind,
      severity: candidate.severity,
      security_event_id: eventId,
      detail: candidate.detail,
    });
    return true;
  } catch {
    // Best-effort: the security_events row is the source of truth; the chain
    // entry is an integrity augmentation and must not fail the scan.
    return false;
  }
}

// Runs a full security scan for one org: detect -> dedup -> persist -> chain.
// Returns counts only (never raw findings) so callers can log a summary without
// leaking detail. Deterministic given the same telemetry and thresholds.
export async function runOrgSecurityScan(
  pool: Pool,
  orgId: string,
  thresholds: DetectionThresholds = DEFAULT_THRESHOLDS
): Promise<ScanResult> {
  const candidates = await runAllDetectors(orgId, thresholds, pool);

  let persisted = 0;
  let chained = 0;

  for (const candidate of candidates) {
    if (await isDuplicate(pool, orgId, candidate)) {
      continue;
    }
    const eventId = await insertEvent(pool, orgId, candidate);
    persisted += 1;

    if (CHAIN_SEVERITIES.has(candidate.severity)) {
      const ok = await chainHighSeverity(orgId, eventId, candidate);
      if (ok) chained += 1;
    }
  }

  return {
    orgId,
    detected: candidates.length,
    persisted,
    chained,
  };
}

// Convenience default-pool wrapper for callers (e.g. the events API) that want
// to trigger an ad-hoc scan without threading a pool.
export async function runOrgSecurityScanDefault(
  orgId: string,
  thresholds: DetectionThresholds = DEFAULT_THRESHOLDS
): Promise<ScanResult> {
  return runOrgSecurityScan(getPool(), orgId, thresholds);
}

// Re-export the finding shape identifiers so consumers (API/UI) share the same
// vocabulary without importing the detector internals.
export type { SecurityEventKind, SecuritySeverity };
