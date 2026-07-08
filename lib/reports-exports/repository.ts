import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import type {
  CreateReportInput,
  ExportStatus,
  ReportType,
} from "@/lib/reports-exports/schemas";
import type { ExportJob, Report } from "@/lib/reports-exports/types";
import type { Column, Row } from "@/lib/reports-exports/documents";

// Data-access layer for reports, export jobs, and the org-scoped source data that
// exports serialize. Every query binds org_id as a parameter (never from client
// input directly) so one tenant can never read another's data. Pure-ish: returns
// new rows, never mutates inputs.

const REPORT_COLUMNS = `
  r.id, r.org_id, r.project_id, r.name, r.type, r.config,
  r.created_by, r.created_at, u.name as created_by_name, u.email as created_by_email
`;

// ---------------------------------------------------------------------------
// Reports CRUD
// ---------------------------------------------------------------------------

interface ListReportsParams {
  orgId: string;
  projectId?: string;
  type?: ReportType;
  limit: number;
  offset: number;
}

export async function listReports(
  params: ListReportsParams,
  pool: Pool = getPool()
): Promise<{ items: Report[]; total: number }> {
  const { orgId, projectId, type, limit, offset } = params;
  const conditions: string[] = ["r.org_id = $1"];
  const values: unknown[] = [orgId];

  if (projectId) {
    values.push(projectId);
    conditions.push(`r.project_id = $${values.length}`);
  }
  if (type) {
    values.push(type);
    conditions.push(`r.type = $${values.length}`);
  }

  const where = conditions.join(" and ");

  const countResult = await pool.query<{ count: string }>(
    `select count(*)::int as count from reports r where ${where}`,
    values
  );
  const total = Number(countResult.rows[0]?.count ?? 0);

  const pageValues = [...values, limit, offset];
  const { rows } = await pool.query<Report>(
    `select ${REPORT_COLUMNS}
       from reports r
       left join users u on u.id = r.created_by
      where ${where}
      order by r.created_at desc
      limit $${pageValues.length - 1} offset $${pageValues.length}`,
    pageValues
  );

  return { items: rows, total };
}

export async function getReport(
  orgId: string,
  id: string,
  pool: Pool = getPool()
): Promise<Report | null> {
  const { rows } = await pool.query<Report>(
    `select ${REPORT_COLUMNS}
       from reports r
       left join users u on u.id = r.created_by
      where r.org_id = $1 and r.id = $2`,
    [orgId, id]
  );
  return rows[0] ?? null;
}

interface CreateReportParams extends CreateReportInput {
  orgId: string;
  createdBy: string | null;
}

export async function createReport(
  params: CreateReportParams,
  pool: Pool = getPool()
): Promise<Report> {
  const { orgId, createdBy, name, type, project_id, config } = params;
  const { rows } = await pool.query<{ id: string }>(
    `insert into reports (org_id, project_id, name, type, config, created_by)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [
      orgId,
      project_id ?? null,
      name,
      type,
      JSON.stringify(config ?? {}),
      createdBy,
    ]
  );
  // Re-read through getReport so the returned row includes the author join.
  const created = await getReport(orgId, rows[0].id, pool);
  if (!created) {
    // Should never happen — the insert just succeeded in the same connection pool.
    throw new Error("Report vanished immediately after creation.");
  }
  return created;
}

export async function deleteReport(
  orgId: string,
  id: string,
  pool: Pool = getPool()
): Promise<boolean> {
  const result = await pool.query(
    `delete from reports where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Export jobs
// ---------------------------------------------------------------------------

interface CreateExportJobParams {
  orgId: string;
  type: ReportType;
  status: ExportStatus;
  params: ExportJob["params"];
  createdBy: string | null;
}

export async function createExportJob(
  input: CreateExportJobParams,
  pool: Pool = getPool()
): Promise<ExportJob> {
  const { orgId, type, status, params, createdBy } = input;
  const { rows } = await pool.query<ExportJob>(
    `insert into export_jobs (org_id, type, status, params, created_by)
     values ($1, $2, $3, $4, $5)
     returning id, org_id, type, status, result_url, params, created_by, created_at`,
    [orgId, type, status, JSON.stringify(params), createdBy]
  );
  return rows[0];
}

export async function listExportJobs(
  orgId: string,
  limit: number,
  offset: number,
  pool: Pool = getPool()
): Promise<{ items: ExportJob[]; total: number }> {
  const countResult = await pool.query<{ count: string }>(
    `select count(*)::int as count from export_jobs where org_id = $1`,
    [orgId]
  );
  const total = Number(countResult.rows[0]?.count ?? 0);

  const { rows } = await pool.query<ExportJob>(
    `select id, org_id, type, status, result_url, params, created_by, created_at
       from export_jobs
      where org_id = $1
      order by created_at desc
      limit $2 offset $3`,
    [orgId, limit, offset]
  );
  return { items: rows, total };
}

// ---------------------------------------------------------------------------
// Org-scoped export data. Each function returns { columns, rows } ready for the
// document serializer. Column order is stable so exports are deterministic.
// ---------------------------------------------------------------------------

export interface ExportDataset {
  columns: Column[];
  rows: Row[];
}

interface ExportQuery {
  orgId: string;
  projectId?: string | null;
}

// Hard cap on rows per export so a huge org can't OOM the serializer / response.
const EXPORT_ROW_LIMIT = 10000;

// Claims scoped to the org (optionally one project).
export async function fetchClaimsForExport(
  q: ExportQuery,
  pool: Pool = getPool()
): Promise<ExportDataset> {
  const values: unknown[] = [q.orgId];
  let where = "c.org_id = $1";
  if (q.projectId) {
    values.push(q.projectId);
    where += ` and c.project_id = $${values.length}`;
  }
  values.push(EXPORT_ROW_LIMIT);

  const { rows } = await pool.query<Row>(
    `select
        c.id,
        c.text,
        c.status,
        c.project_id,
        c.cited_source_url,
        c.created_at
       from claims c
      where ${where}
      order by c.created_at desc
      limit $${values.length}`,
    values
  );

  return {
    columns: [
      { key: "id", label: "Claim ID" },
      { key: "text", label: "Claim Text" },
      { key: "status", label: "Status" },
      { key: "project_id", label: "Project ID" },
      { key: "cited_source_url", label: "Cited Source URL" },
      { key: "created_at", label: "Created At" },
    ],
    rows,
  };
}

// Verifications scoped to the org via their linked claim. The legacy verifications
// table has no org_id, so we join through claims and filter on the claim's org.
export async function fetchVerificationsForExport(
  q: ExportQuery,
  pool: Pool = getPool()
): Promise<ExportDataset> {
  const values: unknown[] = [q.orgId];
  let where = "c.org_id = $1";
  if (q.projectId) {
    values.push(q.projectId);
    where += ` and c.project_id = $${values.length}`;
  }
  values.push(EXPORT_ROW_LIMIT);

  const { rows } = await pool.query<Row>(
    `select
        v.id,
        v.claim_text,
        v.discrepancy_type,
        v.trust_score,
        v.explanation,
        s.title as source_title,
        s.url as source_url,
        v.created_at
       from verifications v
       join claims c on c.id = v.claim_id
       left join sources s on s.id = v.matched_source_id
      where ${where}
      order by v.created_at desc
      limit $${values.length}`,
    values
  );

  return {
    columns: [
      { key: "id", label: "Verification ID" },
      { key: "claim_text", label: "Claim Text" },
      { key: "discrepancy_type", label: "Discrepancy Type" },
      { key: "trust_score", label: "Trust Score" },
      { key: "explanation", label: "Explanation" },
      { key: "source_title", label: "Source Title" },
      { key: "source_url", label: "Source URL" },
      { key: "created_at", label: "Created At" },
    ],
    rows,
  };
}

// Evidence items scoped to the org (optionally one project).
export async function fetchEvidenceForExport(
  q: ExportQuery,
  pool: Pool = getPool()
): Promise<ExportDataset> {
  const values: unknown[] = [q.orgId];
  let where = "e.org_id = $1";
  if (q.projectId) {
    values.push(q.projectId);
    where += ` and e.project_id = $${values.length}`;
  }
  values.push(EXPORT_ROW_LIMIT);

  const { rows } = await pool.query<Record<string, unknown>>(
    `select
        e.id,
        e.source_type,
        e.external_id,
        e.title,
        e.url,
        e.notes,
        e.tags,
        e.created_at
       from evidence_items e
      where ${where}
      order by e.created_at desc
      limit $${values.length}`,
    values
  );

  // tags is jsonb (array) — flatten to a comma-joined string for tabular output.
  const flattened: Row[] = rows.map((r) => ({
    id: r.id as string,
    source_type: r.source_type as string,
    external_id: (r.external_id as string | null) ?? "",
    title: r.title as string,
    url: (r.url as string | null) ?? "",
    notes: (r.notes as string | null) ?? "",
    tags: Array.isArray(r.tags) ? (r.tags as unknown[]).join(", ") : "",
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));

  return {
    columns: [
      { key: "id", label: "Evidence ID" },
      { key: "source_type", label: "Source Type" },
      { key: "external_id", label: "External ID" },
      { key: "title", label: "Title" },
      { key: "url", label: "URL" },
      { key: "notes", label: "Notes" },
      { key: "tags", label: "Tags" },
      { key: "created_at", label: "Created At" },
    ],
    rows: flattened,
  };
}

// Dispatches to the right dataset fetcher for a report/export type.
export async function fetchExportDataset(
  type: ReportType,
  q: ExportQuery,
  pool: Pool = getPool()
): Promise<ExportDataset> {
  switch (type) {
    case "claims":
      return fetchClaimsForExport(q, pool);
    case "verifications":
      return fetchVerificationsForExport(q, pool);
    case "evidence":
      return fetchEvidenceForExport(q, pool);
    default: {
      // Exhaustiveness guard — unreachable given the ReportType union.
      const _never: never = type;
      throw new Error(`Unsupported export type: ${String(_never)}`);
    }
  }
}
