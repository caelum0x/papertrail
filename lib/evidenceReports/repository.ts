import type { Pool } from "pg";
import type {
  CreateEvidenceReportInput,
  EvidenceReportPayload,
  EvidenceReportRecord,
} from "@/lib/evidenceReports/types";

// Data access for persisted evidence reports. Every method is org-scoped: org_id
// is always the FIRST WHERE predicate so a caller can never read or delete another
// tenant's rows. Pure data access — no business logic, no report computation. The
// `report`/`pooled` jsonb columns are stored and returned verbatim; this layer
// never reinterprets the engine's composite object.

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// pg returns jsonb already parsed into a JS value. Narrow it to our opaque
// object payload; treat anything non-object (shouldn't happen for our columns) as
// null so callers never get a surprise primitive.
function toPayload(value: unknown): EvidenceReportPayload | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as EvidenceReportPayload;
  }
  return null;
}

interface ReportRow {
  id: string;
  org_id: string;
  project_id: string | null;
  created_by: string | null;
  claim: string;
  verdict: string | null;
  certainty: string | null;
  pooled: unknown;
  report: unknown;
  created_at: Date | string;
}

function mapReport(row: ReportRow): EvidenceReportRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    projectId: row.project_id,
    createdBy: row.created_by,
    claim: row.claim,
    verdict: row.verdict,
    certainty: row.certainty,
    pooled: toPayload(row.pooled),
    report: toPayload(row.report) ?? {},
    createdAt: toIso(row.created_at),
  };
}

const REPORT_SELECT = `
  select id, org_id, project_id, created_by, claim, verdict, certainty,
         pooled, report, created_at
    from evidence_reports
`;

// Persist a computed evidence report for an org. The caller supplies the already-
// computed composite object; this layer stores it verbatim as jsonb.
export async function createReport(
  pool: Pool,
  input: CreateEvidenceReportInput
): Promise<EvidenceReportRecord> {
  const { rows } = await pool.query<ReportRow>(
    `insert into evidence_reports
       (org_id, project_id, created_by, claim, verdict, certainty, pooled, report)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id, org_id, project_id, created_by, claim, verdict, certainty,
               pooled, report, created_at`,
    [
      input.orgId,
      input.projectId ?? null,
      input.createdBy ?? null,
      input.claim,
      input.verdict ?? null,
      input.certainty ?? null,
      input.pooled != null ? JSON.stringify(input.pooled) : null,
      JSON.stringify(input.report),
    ]
  );
  return mapReport(rows[0]);
}

// List an org's evidence reports, newest first. Paginated. org_id is the first
// (and here only) predicate — a caller sees only their own tenant's reports.
export async function listReports(
  pool: Pool,
  params: { orgId: string; limit: number; offset: number }
): Promise<{ items: EvidenceReportRecord[]; total: number }> {
  const countRes = await pool.query<{ total: number }>(
    `select count(*)::int as total from evidence_reports where org_id = $1`,
    [params.orgId]
  );
  const total = countRes.rows[0]?.total ?? 0;

  const { rows } = await pool.query<ReportRow>(
    `${REPORT_SELECT}
      where org_id = $1
      order by created_at desc
      limit $2 offset $3`,
    [params.orgId, params.limit, params.offset]
  );
  return { items: rows.map(mapReport), total };
}

// Fetch a single report by id, scoped to the org. Returns null when it does not
// exist OR belongs to another org — the two are indistinguishable to the caller.
export async function getReport(
  pool: Pool,
  orgId: string,
  id: string
): Promise<EvidenceReportRecord | null> {
  const { rows } = await pool.query<ReportRow>(
    `${REPORT_SELECT} where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return rows.length ? mapReport(rows[0]) : null;
}

// Delete a report by id, scoped to the org. Returns true if a row was removed,
// false if nothing matched (missing, or owned by another org).
export async function deleteReport(
  pool: Pool,
  orgId: string,
  id: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `delete from evidence_reports where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return (rowCount ?? 0) > 0;
}
