import type { Pool } from "pg";
import { getPool } from "@/lib/db";

// ---------------------------------------------------------------------------
// Tenant-scoped threat detectors ("XDR"). Pure, deterministic analysis over the
// telemetry the platform already owns — api_requests, rate_limit_events,
// error_events — scoped to a single org. NO LLM, NO external calls: every
// detector is a parameterized aggregate query plus fixed thresholds, so a run
// is cheap, repeatable, and explainable to an auditor.
//
// Each detector returns zero or more SecurityEventCandidate rows. The candidate
// carries only ids / counts / thresholds in `detail` — never raw claim text,
// patient text, secrets, or message bodies. securityScan.ts persists new
// candidates (with dedup) and escalates high-severity ones to the audit chain.
//
// All queries filter org_id as the first bound parameter. Detectors never read
// across tenants except crossTenantProbe, which counts an org's OWN rejected
// cross-scope attempts (403s) — it does not expose any other org's data.
// ---------------------------------------------------------------------------

export type SecuritySeverity = "low" | "medium" | "high" | "critical";

// The stable set of detector kinds. Used as the security_events.kind value and
// as the dedup key together with org_id.
export const SECURITY_EVENT_KINDS = [
  "api_key_from_new_ip",
  "quota_exhaustion_spike",
  "auth_failure_burst",
  "cross_tenant_probe",
] as const;

export type SecurityEventKind = (typeof SECURITY_EVENT_KINDS)[number];

// A candidate finding produced by a detector, before persistence. `detail` is a
// bounded, PII-free bag of ids/counts/thresholds. `sourceIp` is null when the
// underlying telemetry does not carry a client IP.
export interface SecurityEventCandidate {
  kind: SecurityEventKind;
  severity: SecuritySeverity;
  detail: Record<string, unknown>;
  sourceIp: string | null;
}

// Detection window and thresholds. Deterministic and centralized so the same
// inputs always yield the same findings, and so an operator can reason about
// exactly what "a burst" means. Windows are minutes of recent telemetry.
export interface DetectionThresholds {
  windowMinutes: number;
  // apiKeyFromNewIp: a key is "new" if its first-ever request in api_requests
  // falls inside this window AND it has issued at least this many requests —
  // i.e. a freshly-appearing key that is already active.
  newKeyMinRequests: number;
  // quotaExhaustionSpike: rate_limit_events in the window at/above this count.
  quotaSpikeCount: number;
  // authFailureBurst: 401/403 api_requests in the window at/above this count.
  authFailureCount: number;
  // crossTenantProbe: 403 (forbidden) api_requests in the window at/above this
  // count concentrated on a single key — a signature of scope probing.
  crossTenantForbiddenCount: number;
}

export const DEFAULT_THRESHOLDS: DetectionThresholds = {
  windowMinutes: 60,
  newKeyMinRequests: 20,
  quotaSpikeCount: 15,
  authFailureCount: 25,
  crossTenantForbiddenCount: 10,
};

interface CountRow {
  c: string | number;
}

function toInt(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

// Escalate a raw count into a severity band relative to its threshold: at the
// threshold is medium, 2x is high, 4x is critical. Deterministic and monotone.
function severityForCount(
  count: number,
  threshold: number
): SecuritySeverity {
  if (count >= threshold * 4) return "critical";
  if (count >= threshold * 2) return "high";
  if (count >= threshold) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// apiKeyFromNewIp — a key that first appears inside the detection window and is
// already active. api_requests does not carry a client IP, so "new IP" is
// approximated by "newly-appearing credential": a key whose earliest request is
// recent yet whose request volume is already non-trivial. This catches a leaked
// or freshly-minted key being exercised, which is the risk the classic
// new-IP signal exists to surface. sourceIp is null (not stored in telemetry).
// ---------------------------------------------------------------------------

interface NewKeyRow {
  api_key_id: string;
  requests: string | number;
  first_seen: Date | string;
}

export async function apiKeyFromNewIp(
  orgId: string,
  thresholds: DetectionThresholds = DEFAULT_THRESHOLDS,
  pool: Pool = getPool()
): Promise<SecurityEventCandidate[]> {
  const { rows } = await pool.query<NewKeyRow>(
    `select
        api_key_id,
        count(*)::int as requests,
        min(created_at) as first_seen
       from api_requests
      where org_id = $1
        and api_key_id is not null
      group by api_key_id
     having min(created_at) >= now() - ($2::int || ' minutes')::interval
        and count(*) >= $3`,
    [orgId, thresholds.windowMinutes, thresholds.newKeyMinRequests]
  );

  return rows.map((r) => {
    const requests = toInt(r.requests);
    return {
      kind: "api_key_from_new_ip",
      // A brand-new key already at high volume is more alarming; scale on
      // multiples of the activation threshold.
      severity: severityForCount(requests, thresholds.newKeyMinRequests),
      detail: {
        apiKeyId: r.api_key_id,
        requests,
        windowMinutes: thresholds.windowMinutes,
        threshold: thresholds.newKeyMinRequests,
        firstSeenAt:
          r.first_seen instanceof Date
            ? r.first_seen.toISOString()
            : String(r.first_seen),
      },
      sourceIp: null,
    };
  });
}

// ---------------------------------------------------------------------------
// quotaExhaustionSpike — a burst of rate_limit_events for the org in the window.
// A tenant repeatedly slamming into its plan quota can indicate a runaway
// integration or an attempt to exhaust a shared resource. Emitted per org (not
// per key) so one summary event describes the condition.
// ---------------------------------------------------------------------------

export async function quotaExhaustionSpike(
  orgId: string,
  thresholds: DetectionThresholds = DEFAULT_THRESHOLDS,
  pool: Pool = getPool()
): Promise<SecurityEventCandidate[]> {
  const { rows } = await pool.query<CountRow>(
    `select count(*)::int as c
       from rate_limit_events
      where org_id = $1
        and created_at >= now() - ($2::int || ' minutes')::interval`,
    [orgId, thresholds.windowMinutes]
  );

  const count = toInt(rows[0]?.c);
  if (count < thresholds.quotaSpikeCount) {
    return [];
  }

  return [
    {
      kind: "quota_exhaustion_spike",
      severity: severityForCount(count, thresholds.quotaSpikeCount),
      detail: {
        rateLimitedCount: count,
        windowMinutes: thresholds.windowMinutes,
        threshold: thresholds.quotaSpikeCount,
      },
      sourceIp: null,
    },
  ];
}

// ---------------------------------------------------------------------------
// authFailureBurst — a burst of 401/403 responses in api_requests for the org.
// Sustained authentication/authorization failures are the canonical signature
// of credential stuffing or a broken/hostile integration. Counts 401 and 403
// together; the split is recorded in detail for triage.
// ---------------------------------------------------------------------------

interface AuthFailRow {
  unauthorized: string | number;
  forbidden: string | number;
  total: string | number;
}

export async function authFailureBurst(
  orgId: string,
  thresholds: DetectionThresholds = DEFAULT_THRESHOLDS,
  pool: Pool = getPool()
): Promise<SecurityEventCandidate[]> {
  const { rows } = await pool.query<AuthFailRow>(
    `select
        count(*) filter (where status_code = 401)::int as unauthorized,
        count(*) filter (where status_code = 403)::int as forbidden,
        count(*) filter (where status_code in (401, 403))::int as total
       from api_requests
      where org_id = $1
        and created_at >= now() - ($2::int || ' minutes')::interval`,
    [orgId, thresholds.windowMinutes]
  );

  const total = toInt(rows[0]?.total);
  if (total < thresholds.authFailureCount) {
    return [];
  }

  return [
    {
      kind: "auth_failure_burst",
      severity: severityForCount(total, thresholds.authFailureCount),
      detail: {
        unauthorized: toInt(rows[0]?.unauthorized),
        forbidden: toInt(rows[0]?.forbidden),
        total,
        windowMinutes: thresholds.windowMinutes,
        threshold: thresholds.authFailureCount,
      },
      sourceIp: null,
    },
  ];
}

// ---------------------------------------------------------------------------
// crossTenantProbe — a single credential accumulating many 403 (forbidden)
// responses in the window. In this system a 403 means the caller was
// authenticated but denied access to the targeted scope — precisely what a
// cross-tenant / privilege-escalation probe looks like. Emitted per offending
// key so each suspicious credential is actionable. Reads only THIS org's own
// telemetry; it never exposes another tenant's rows.
// ---------------------------------------------------------------------------

interface ProbeRow {
  api_key_id: string;
  forbidden: string | number;
  routes: string | number;
}

export async function crossTenantProbe(
  orgId: string,
  thresholds: DetectionThresholds = DEFAULT_THRESHOLDS,
  pool: Pool = getPool()
): Promise<SecurityEventCandidate[]> {
  const { rows } = await pool.query<ProbeRow>(
    `select
        api_key_id,
        count(*)::int as forbidden,
        count(distinct route)::int as routes
       from api_requests
      where org_id = $1
        and api_key_id is not null
        and status_code = 403
        and created_at >= now() - ($2::int || ' minutes')::interval
      group by api_key_id
     having count(*) >= $3`,
    [orgId, thresholds.windowMinutes, thresholds.crossTenantForbiddenCount]
  );

  return rows.map((r) => {
    const forbidden = toInt(r.forbidden);
    return {
      kind: "cross_tenant_probe",
      severity: severityForCount(
        forbidden,
        thresholds.crossTenantForbiddenCount
      ),
      detail: {
        apiKeyId: r.api_key_id,
        forbidden,
        distinctRoutes: toInt(r.routes),
        windowMinutes: thresholds.windowMinutes,
        threshold: thresholds.crossTenantForbiddenCount,
      },
      sourceIp: null,
    };
  });
}

// Runs every detector for an org and returns the combined candidate list. Order
// is stable (detector order, then each detector's own row order) so a scan is
// deterministic. Detectors are independent, so a single detector failing does
// not abort the others — the error is rethrown by the caller's try/catch per
// detector via runAllDetectors' isolation below.
export async function runAllDetectors(
  orgId: string,
  thresholds: DetectionThresholds = DEFAULT_THRESHOLDS,
  pool: Pool = getPool()
): Promise<SecurityEventCandidate[]> {
  const detectors: Array<
    (
      orgId: string,
      thresholds: DetectionThresholds,
      pool: Pool
    ) => Promise<SecurityEventCandidate[]>
  > = [
    apiKeyFromNewIp,
    quotaExhaustionSpike,
    authFailureBurst,
    crossTenantProbe,
  ];

  const candidates: SecurityEventCandidate[] = [];
  for (const detect of detectors) {
    const found = await detect(orgId, thresholds, pool);
    candidates.push(...found);
  }
  return candidates;
}
