import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import type {
  ExportFormat,
  ExportScope,
  ExportStatus,
} from "@/lib/dataexport/schemas";
import type { DataExport, ExportParams } from "@/lib/dataexport/types";

// Data-access layer for data_exports. Every query binds org_id as a parameter
// (never from client input directly) so one tenant can never read another's
// exports. Pure-ish: returns new rows, never mutates inputs.

const EXPORT_COLUMNS = `
  e.id, e.org_id, e.scope, e.format, e.status, e.row_count, e.params,
  e.created_by, e.created_at,
  u.name as created_by_name, u.email as created_by_email
`;

interface ListExportsParams {
  orgId: string;
  scope?: ExportScope;
  limit: number;
  offset: number;
}

export async function listExports(
  params: ListExportsParams,
  pool: Pool = getPool()
): Promise<{ items: DataExport[]; total: number }> {
  const { orgId, scope, limit, offset } = params;
  const conditions: string[] = ["e.org_id = $1"];
  const values: unknown[] = [orgId];

  if (scope) {
    values.push(scope);
    conditions.push(`e.scope = $${values.length}`);
  }

  const where = conditions.join(" and ");

  const countResult = await pool.query<{ count: string }>(
    `select count(*)::int as count from data_exports e where ${where}`,
    values
  );
  const total = Number(countResult.rows[0]?.count ?? 0);

  const pageValues = [...values, limit, offset];
  const { rows } = await pool.query<DataExport>(
    `select ${EXPORT_COLUMNS}
       from data_exports e
       left join users u on u.id = e.created_by
      where ${where}
      order by e.created_at desc
      limit $${pageValues.length - 1} offset $${pageValues.length}`,
    pageValues
  );

  return { items: rows, total };
}

export async function getExport(
  orgId: string,
  id: string,
  pool: Pool = getPool()
): Promise<DataExport | null> {
  const { rows } = await pool.query<DataExport>(
    `select ${EXPORT_COLUMNS}
       from data_exports e
       left join users u on u.id = e.created_by
      where e.org_id = $1 and e.id = $2`,
    [orgId, id]
  );
  return rows[0] ?? null;
}

interface CreateExportParams {
  orgId: string;
  scope: ExportScope;
  format: ExportFormat;
  status: ExportStatus;
  rowCount: number;
  params: ExportParams;
  createdBy: string | null;
}

export async function createExport(
  input: CreateExportParams,
  pool: Pool = getPool()
): Promise<DataExport> {
  const { orgId, scope, format, status, rowCount, params, createdBy } = input;
  const { rows } = await pool.query<{ id: string }>(
    `insert into data_exports (org_id, scope, format, status, row_count, params, created_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [orgId, scope, format, status, rowCount, JSON.stringify(params), createdBy]
  );
  // Re-read through getExport so the returned row includes the author join.
  const created = await getExport(orgId, rows[0].id, pool);
  if (!created) {
    // Should never happen — the insert just succeeded in the same pool.
    throw new Error("Export vanished immediately after creation.");
  }
  return created;
}
