import type { Pool } from "pg";
import type {
  EvidenceExportBundle,
  ExportedEngineUsage,
  ExportedEvidenceReport,
  RetentionPolicy,
  RetentionResult,
  SetRetentionPolicyInput,
} from "@/lib/governance/retention.schemas";

// Data access + deterministic logic for the DATA-RETENTION governance layer.
//
// Two governed data classes live in tables owned by other verticals — we import
// their NAMES only and never edit those modules:
//   * evidence_reports (db/migrations/0049) — persisted composite reports
//   * engine_usage     (db/migrations/0054) — per-engine metering rows
//
// Every function here is org-scoped: org_id is ALWAYS the first predicate, and
// the org id is the RESOLVED server-side value (ctx.org.id) — never a
// client-supplied org id. All SQL is parameterized; no value is interpolated.
//
// Retention semantics: a null window for a data class means "keep forever" — we
// skip deletion for that class entirely rather than treating null as 0. This is
// the safe default: an org with no policy loses nothing.

const EVIDENCE_REPORTS_TABLE = "evidence_reports";
const ENGINE_USAGE_TABLE = "engine_usage";

interface PolicyRow {
  org_id: string;
  evidence_reports_days: number | null;
  engine_usage_days: number | null;
  audit_days: number | null;
  updated_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapPolicy(row: PolicyRow): RetentionPolicy {
  return {
    orgId: row.org_id,
    evidenceReportsDays: row.evidence_reports_days,
    engineUsageDays: row.engine_usage_days,
    auditDays: row.audit_days,
    updatedAt: toIso(row.updated_at),
  };
}

// ---- Policy read/write -----------------------------------------------------

// The org's retention policy, or null if it has never configured one. Null is a
// meaningful state — the caller treats "no policy" as "keep everything forever".
export async function getPolicy(
  pool: Pool,
  orgId: string
): Promise<RetentionPolicy | null> {
  const { rows } = await pool.query<PolicyRow>(
    `select org_id, evidence_reports_days, engine_usage_days, audit_days, updated_at
       from org_retention_policies
      where org_id = $1`,
    [orgId]
  );
  return rows.length ? mapPolicy(rows[0]) : null;
}

// Upserts the org's policy. Only the fields present in `input` are written; an
// omitted field leaves the existing stored window unchanged (coalesce keeps the
// prior value), while an explicit null clears the window to "keep forever".
// A single upsert keeps exactly one policy row per org (org_id is the pk).
export async function setPolicy(
  pool: Pool,
  orgId: string,
  input: SetRetentionPolicyInput
): Promise<RetentionPolicy> {
  const hasEvidence = input.evidenceReportsDays !== undefined;
  const hasEngine = input.engineUsageDays !== undefined;
  const hasAudit = input.auditDays !== undefined;

  const { rows } = await pool.query<PolicyRow>(
    `insert into org_retention_policies
       (org_id, evidence_reports_days, engine_usage_days, audit_days, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (org_id) do update set
       evidence_reports_days =
         case when $5 then excluded.evidence_reports_days
              else org_retention_policies.evidence_reports_days end,
       engine_usage_days =
         case when $6 then excluded.engine_usage_days
              else org_retention_policies.engine_usage_days end,
       audit_days =
         case when $7 then excluded.audit_days
              else org_retention_policies.audit_days end,
       updated_at = now()
     returning org_id, evidence_reports_days, engine_usage_days, audit_days, updated_at`,
    [
      orgId,
      hasEvidence ? (input.evidenceReportsDays ?? null) : null,
      hasEngine ? (input.engineUsageDays ?? null) : null,
      hasAudit ? (input.auditDays ?? null) : null,
      hasEvidence,
      hasEngine,
      hasAudit,
    ]
  );
  return mapPolicy(rows[0]);
}

// ---- Enforcement -----------------------------------------------------------

// Deletes rows in one governed table older than `days`, scoped to the org.
// org_id is the FIRST predicate; the age cutoff is computed in SQL from a
// parameterized day count so no timestamp arithmetic crosses the trust boundary.
// The table name is a fixed internal constant (never a client value), so
// interpolating it here does not open an injection path.
async function deleteOlderThan(
  pool: Pool,
  table: typeof EVIDENCE_REPORTS_TABLE | typeof ENGINE_USAGE_TABLE,
  orgId: string,
  days: number | null,
  timeColumn: "created_at" | "occurred_at"
): Promise<number> {
  // Null window = keep forever: nothing to delete.
  if (days === null) return 0;

  const { rowCount } = await pool.query(
    `delete from ${table}
      where org_id = $1
        and ${timeColumn} < now() - ($2 || ' days')::interval`,
    [orgId, String(days)]
  );
  return rowCount ?? 0;
}

// Enforces the org's retention policy by purging aged rows from each governed
// data class. A class with a null (or unset) window is skipped. Returns the
// per-class deletion counts. Audit is intentionally NOT auto-purged here: the
// audit trail is append-only evidence, purged only via an explicit governance
// action, so audit_days is advisory metadata rather than an auto-delete trigger.
export async function applyRetention(
  pool: Pool,
  orgId: string
): Promise<RetentionResult> {
  const policy = await getPolicy(pool, orgId);

  const evidenceReportsDeleted = await deleteOlderThan(
    pool,
    EVIDENCE_REPORTS_TABLE,
    orgId,
    policy?.evidenceReportsDays ?? null,
    "created_at"
  );
  const engineUsageDeleted = await deleteOlderThan(
    pool,
    ENGINE_USAGE_TABLE,
    orgId,
    policy?.engineUsageDays ?? null,
    "occurred_at"
  );

  return {
    orgId,
    evidenceReportsDeleted,
    engineUsageDeleted,
    appliedAt: new Date().toISOString(),
  };
}

// ---- DSAR-style portability export -----------------------------------------

interface EvidenceReportRow {
  id: string;
  project_id: string | null;
  created_by: string | null;
  claim: string;
  verdict: string | null;
  certainty: string | null;
  pooled: unknown;
  report: unknown;
  created_at: Date | string;
}

function mapEvidenceReport(row: EvidenceReportRow): ExportedEvidenceReport {
  return {
    id: row.id,
    projectId: row.project_id,
    createdBy: row.created_by,
    claim: row.claim,
    verdict: row.verdict,
    certainty: row.certainty,
    pooled: row.pooled ?? null,
    report: row.report,
    createdAt: toIso(row.created_at),
  };
}

interface EngineUsageRow {
  id: string;
  engine: string;
  units: number;
  claude_tokens: number;
  occurred_at: Date | string;
}

function mapEngineUsage(row: EngineUsageRow): ExportedEngineUsage {
  return {
    id: row.id,
    engine: row.engine,
    units: row.units,
    claudeTokens: row.claude_tokens,
    occurredAt: toIso(row.occurred_at),
  };
}

// Gathers the org's evidence artifacts into ONE portability bundle for a
// data-subject / DSAR export. Everything is org-scoped: org_id is the first
// predicate on every query, so the bundle can only ever contain the requesting
// org's rows. The bundle also embeds the current retention policy so the export
// is self-describing (a reviewer can see the governance context of the data).
export async function exportOrgEvidence(
  pool: Pool,
  orgId: string
): Promise<EvidenceExportBundle> {
  const policy = await getPolicy(pool, orgId);

  const reportsRes = await pool.query<EvidenceReportRow>(
    `select id, project_id, created_by, claim, verdict, certainty,
            pooled, report, created_at
       from evidence_reports
      where org_id = $1
      order by created_at desc`,
    [orgId]
  );

  const usageRes = await pool.query<EngineUsageRow>(
    `select id, engine, units, claude_tokens, occurred_at
       from engine_usage
      where org_id = $1
      order by occurred_at desc`,
    [orgId]
  );

  const evidenceReports = reportsRes.rows.map(mapEvidenceReport);
  const engineUsage = usageRes.rows.map(mapEngineUsage);

  return {
    orgId,
    exportedAt: new Date().toISOString(),
    policy,
    evidenceReports,
    engineUsage,
    counts: {
      evidenceReports: evidenceReports.length,
      engineUsage: engineUsage.length,
    },
  };
}
