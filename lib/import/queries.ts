import type { Pool, PoolClient } from "pg";
import type {
  ImportBatch,
  ImportBatchStatus,
  ImportFormat,
  ImportRow,
  ImportTarget,
} from "@/lib/import/types";

// Data access for the bulk import center. Batches stage parsed rows; committing a
// batch reads its rows, applies the mapping, and inserts into the real target
// tables inside a single transaction. Org-scoped throughout.

interface BatchRow {
  id: string;
  org_id: string;
  target: string;
  format: string;
  status: string;
  total: number;
  succeeded: number;
  failed: number;
  mapping: Record<string, string> | null;
  error: string | null;
  created_by: string | null;
  created_at: Date | string;
}

interface RowRow {
  id: string;
  org_id: string;
  batch_id: string;
  row_index: number;
  data: Record<string, string> | null;
  status: string;
  error: string | null;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapBatch(row: BatchRow): ImportBatch {
  return {
    id: row.id,
    orgId: row.org_id,
    target: row.target as ImportTarget,
    format: row.format as ImportFormat,
    status: row.status as ImportBatchStatus,
    total: row.total,
    succeeded: row.succeeded,
    failed: row.failed,
    mapping: row.mapping ?? {},
    error: row.error,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
  };
}

function mapRow(row: RowRow): ImportRow {
  return {
    id: row.id,
    orgId: row.org_id,
    batchId: row.batch_id,
    rowIndex: row.row_index,
    data: row.data ?? {},
    status: row.status as ImportRow["status"],
    error: row.error,
    createdAt: toIso(row.created_at),
  };
}

const BATCH_COLS = `id, org_id, target, format, status, total, succeeded, failed,
  mapping, error, created_by, created_at`;
const ROW_COLS = `id, org_id, batch_id, row_index, data, status, error, created_at`;

// ---------------------------------------------------------------------------
// Batch creation (with staged rows) in one transaction
// ---------------------------------------------------------------------------

export interface CreateBatchInput {
  orgId: string;
  createdBy: string;
  target: ImportTarget;
  format: ImportFormat;
  mapping: Record<string, string>;
  rows: Record<string, string>[];
}

// Insert a batch plus its staged rows atomically. Returns the created batch.
export async function createBatch(
  pool: Pool,
  input: CreateBatchInput
): Promise<ImportBatch> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows: batchRows } = await client.query<BatchRow>(
      `insert into import_batches
         (org_id, target, format, status, total, mapping, created_by)
       values ($1, $2, $3, 'pending', $4, $5::jsonb, $6)
       returning ${BATCH_COLS}`,
      [
        input.orgId,
        input.target,
        input.format,
        input.rows.length,
        JSON.stringify(input.mapping ?? {}),
        input.createdBy,
      ]
    );
    const batch = batchRows[0];

    for (let index = 0; index < input.rows.length; index++) {
      await client.query(
        `insert into import_rows (org_id, batch_id, row_index, data, status)
         values ($1, $2, $3, $4::jsonb, 'pending')`,
        [input.orgId, batch.id, index, JSON.stringify(input.rows[index] ?? {})]
      );
    }

    await client.query("commit");
    return mapBatch(batch);
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function countBatches(pool: Pool, orgId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::int as count from import_batches where org_id = $1`,
    [orgId]
  );
  return Number(rows[0]?.count ?? 0);
}

export async function listBatches(
  pool: Pool,
  orgId: string,
  limit: number,
  offset: number
): Promise<ImportBatch[]> {
  const { rows } = await pool.query<BatchRow>(
    `select ${BATCH_COLS} from import_batches
      where org_id = $1
      order by created_at desc
      limit $2 offset $3`,
    [orgId, limit, offset]
  );
  return rows.map(mapBatch);
}

export async function getBatch(
  pool: Pool,
  orgId: string,
  batchId: string
): Promise<ImportBatch | null> {
  const { rows } = await pool.query<BatchRow>(
    `select ${BATCH_COLS} from import_batches where org_id = $1 and id = $2`,
    [orgId, batchId]
  );
  return rows[0] ? mapBatch(rows[0]) : null;
}

export async function listBatchRows(
  pool: Pool,
  orgId: string,
  batchId: string,
  limit: number,
  offset: number
): Promise<ImportRow[]> {
  const { rows } = await pool.query<RowRow>(
    `select ${ROW_COLS} from import_rows
      where org_id = $1 and batch_id = $2
      order by row_index asc
      limit $3 offset $4`,
    [orgId, batchId, limit, offset]
  );
  return rows.map(mapRow);
}

export async function countBatchRows(
  pool: Pool,
  orgId: string,
  batchId: string
): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::int as count from import_rows
      where org_id = $1 and batch_id = $2`,
    [orgId, batchId]
  );
  return Number(rows[0]?.count ?? 0);
}

// Fetch every staged row for a batch (ordered) — used at commit time.
async function allBatchRows(
  client: PoolClient,
  orgId: string,
  batchId: string
): Promise<ImportRow[]> {
  const { rows } = await client.query<RowRow>(
    `select ${ROW_COLS} from import_rows
      where org_id = $1 and batch_id = $2
      order by row_index asc`,
    [orgId, batchId]
  );
  return rows.map(mapRow);
}

// ---------------------------------------------------------------------------
// Commit: apply mapping and insert into target tables
// ---------------------------------------------------------------------------

export interface CommitResult {
  batch: ImportBatch;
  succeeded: number;
  failed: number;
}

// Reads a mapped value off a staged row. `mapping[fieldKey]` names the source
// column; an unmapped field yields "".
function mapped(
  data: Record<string, string>,
  mapping: Record<string, string>,
  fieldKey: string
): string {
  const source = mapping[fieldKey];
  if (!source) return "";
  return (data[source] ?? "").trim();
}

// Insert one mapped row into the target table. Throws on validation/DB error so
// the caller marks the row failed. Returns nothing on success.
async function insertTargetRow(
  client: PoolClient,
  orgId: string,
  target: ImportTarget,
  createdBy: string,
  libraryId: string | null,
  data: Record<string, string>,
  mapping: Record<string, string>
): Promise<void> {
  if (target === "claims") {
    const text = mapped(data, mapping, "text");
    if (!text) throw new Error("Missing required field: claim text.");
    const url = mapped(data, mapping, "cited_source_url") || null;
    const statusRaw = mapped(data, mapping, "status");
    const status = statusRaw || "draft";
    await client.query(
      `insert into claims (org_id, text, cited_source_url, status, submitted_by)
       values ($1, $2, $3, $4, $5)`,
      [orgId, text, url, status, createdBy]
    );
    return;
  }

  if (target === "evidence") {
    const title = mapped(data, mapping, "title");
    if (!title) throw new Error("Missing required field: title.");
    const sourceTypeRaw = mapped(data, mapping, "source_type").toLowerCase();
    const sourceType = ["pubmed", "clinicaltrials", "document", "other"].includes(
      sourceTypeRaw
    )
      ? sourceTypeRaw
      : "other";
    await client.query(
      `insert into evidence_items
         (org_id, source_type, external_id, title, url, notes, added_by)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        orgId,
        sourceType,
        mapped(data, mapping, "external_id") || null,
        title,
        mapped(data, mapping, "url") || null,
        mapped(data, mapping, "notes") || null,
        createdBy,
      ]
    );
    return;
  }

  // references
  if (!libraryId) {
    throw new Error("A target reference library is required.");
  }
  const title = mapped(data, mapping, "title");
  if (!title) throw new Error("Missing required field: title.");
  const authorsRaw = mapped(data, mapping, "authors");
  const authors = authorsRaw
    ? authorsRaw
        .split(/[;\n]/)
        .map((a) => a.trim())
        .filter((a) => a.length > 0)
    : [];
  const yearRaw = mapped(data, mapping, "year");
  const yearMatch = yearRaw.match(/\d{4}/);
  const year = yearMatch ? Number(yearMatch[0]) : null;
  const typeRaw = mapped(data, mapping, "type");
  await client.query(
    `insert into "references"
       (org_id, library_id, type, title, authors, year, journal, doi, pmid, nct_id, url, raw)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, '{}'::jsonb)`,
    [
      orgId,
      libraryId,
      typeRaw || "article",
      title,
      JSON.stringify(authors),
      year,
      mapped(data, mapping, "journal") || null,
      mapped(data, mapping, "doi") || null,
      mapped(data, mapping, "pmid") || null,
      mapped(data, mapping, "nct_id") || null,
      mapped(data, mapping, "url") || null,
    ]
  );
}

export interface CommitBatchInput {
  orgId: string;
  batchId: string;
  createdBy: string;
  mapping: Record<string, string>;
  target: ImportTarget;
  libraryId: string | null;
}

// Commit a batch: insert each staged row into the target table, tracking per-row
// success/failure. The whole commit runs in one transaction; a row that fails is
// marked failed (its individual insert rolled back via a savepoint) without
// aborting the rest. Idempotent-ish: only rows still in 'pending' are processed,
// so a re-commit after a partial failure resumes the remaining rows.
export async function commitBatch(
  pool: Pool,
  input: CommitBatchInput
): Promise<CommitResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    await client.query(
      `update import_batches set status = 'committing', mapping = $3::jsonb, error = null
        where org_id = $1 and id = $2`,
      [input.orgId, input.batchId, JSON.stringify(input.mapping)]
    );

    const rows = await allBatchRows(client, input.orgId, input.batchId);
    let succeeded = 0;
    let failed = 0;

    for (const row of rows) {
      if (row.status === "succeeded") {
        succeeded += 1;
        continue;
      }
      try {
        await client.query("savepoint import_row");
        await insertTargetRow(
          client,
          input.orgId,
          input.target,
          input.createdBy,
          input.libraryId,
          row.data,
          input.mapping
        );
        await client.query("release savepoint import_row");
        await client.query(
          `update import_rows set status = 'succeeded', error = null
            where org_id = $1 and id = $2`,
          [input.orgId, row.id]
        );
        succeeded += 1;
      } catch (err) {
        await client.query("rollback to savepoint import_row");
        const message = err instanceof Error ? err.message : "Row insert failed.";
        await client.query(
          `update import_rows set status = 'failed', error = $3
            where org_id = $1 and id = $2`,
          [input.orgId, row.id, message.slice(0, 500)]
        );
        failed += 1;
      }
    }

    const finalStatus: ImportBatchStatus =
      failed > 0 && succeeded === 0 ? "failed" : "committed";
    const { rows: updated } = await client.query<BatchRow>(
      `update import_batches
          set status = $3, succeeded = $4, failed = $5,
              error = case when $3 = 'failed' then 'All rows failed to import.' else null end
        where org_id = $1 and id = $2
        returning ${BATCH_COLS}`,
      [input.orgId, input.batchId, finalStatus, succeeded, failed]
    );

    await client.query("commit");
    return { batch: mapBatch(updated[0]), succeeded, failed };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

// Confirms a reference library belongs to the org (guards references imports).
export async function isOrgLibrary(
  pool: Pool,
  orgId: string,
  libraryId: string
): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `select exists(
       select 1 from reference_libraries where org_id = $1 and id = $2
     ) as exists`,
    [orgId, libraryId]
  );
  return Boolean(rows[0]?.exists);
}
