import type { Pool } from "pg";
import type {
  DocumentDetail,
  DocumentPage,
  DocumentStatus,
  DocumentSummary,
} from "@/lib/documents/types";

// Data access for documents. Every query is org-scoped: callers pass ctx.org.id
// and rows belonging to other orgs are never returned or mutated.

const SUMMARY_COLUMNS = `
  id, project_id, filename, mime_type, size_bytes, status,
  uploaded_by, created_at, updated_at
`;

function toSummary(row: Record<string, unknown>): DocumentSummary {
  return {
    id: String(row.id),
    project_id: row.project_id ? String(row.project_id) : null,
    filename: String(row.filename),
    mime_type: String(row.mime_type),
    size_bytes: Number(row.size_bytes),
    status: String(row.status) as DocumentStatus,
    uploaded_by: row.uploaded_by ? String(row.uploaded_by) : null,
    created_at: new Date(row.created_at as string).toISOString(),
    updated_at: new Date(row.updated_at as string).toISOString(),
  };
}

export interface ListResult {
  documents: DocumentSummary[];
  total: number;
}

export async function listDocuments(
  pool: Pool,
  orgId: string,
  opts: { limit: number; offset: number; projectId?: string | null }
): Promise<ListResult> {
  const params: unknown[] = [orgId];
  let where = "org_id = $1";
  if (opts.projectId) {
    params.push(opts.projectId);
    where += ` and project_id = $${params.length}`;
  }

  const countRes = await pool.query(
    `select count(*)::int as total from documents where ${where}`,
    params
  );
  const total = Number(countRes.rows[0]?.total ?? 0);

  params.push(opts.limit, opts.offset);
  const rowsRes = await pool.query(
    `select ${SUMMARY_COLUMNS} from documents
      where ${where}
      order by created_at desc
      limit $${params.length - 1} offset $${params.length}`,
    params
  );

  return { documents: rowsRes.rows.map(toSummary), total };
}

export interface CreateDocumentRow {
  orgId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  projectId: string | null;
  storageKey: string | null;
  extractedText: string | null;
  status: DocumentStatus;
  uploadedBy: string | null;
}

export async function insertDocument(
  pool: Pool,
  input: CreateDocumentRow
): Promise<DocumentSummary> {
  const res = await pool.query(
    `insert into documents
       (org_id, project_id, filename, mime_type, size_bytes,
        storage_key, extracted_text, status, uploaded_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning ${SUMMARY_COLUMNS}`,
    [
      input.orgId,
      input.projectId,
      input.filename,
      input.mimeType,
      input.sizeBytes,
      input.storageKey,
      input.extractedText,
      input.status,
      input.uploadedBy,
    ]
  );
  return toSummary(res.rows[0]);
}

export async function getDocument(
  pool: Pool,
  orgId: string,
  id: string
): Promise<DocumentDetail | null> {
  const res = await pool.query(
    `select ${SUMMARY_COLUMNS}, storage_key, extracted_text
       from documents
      where org_id = $1 and id = $2`,
    [orgId, id]
  );
  if (res.rows.length === 0) {
    return null;
  }
  const row = res.rows[0];
  const countRes = await pool.query(
    `select count(*)::int as page_count from document_pages where document_id = $1`,
    [id]
  );
  return {
    ...toSummary(row),
    storage_key: row.storage_key ? String(row.storage_key) : null,
    extracted_text: row.extracted_text ? String(row.extracted_text) : null,
    page_count: Number(countRes.rows[0]?.page_count ?? 0),
  };
}

export async function deleteDocument(
  pool: Pool,
  orgId: string,
  id: string
): Promise<boolean> {
  const res = await pool.query(
    `delete from documents where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function getDocumentText(
  pool: Pool,
  orgId: string,
  id: string
): Promise<{ extracted_text: string | null; pages: DocumentPage[] } | null> {
  const docRes = await pool.query(
    `select extracted_text from documents where org_id = $1 and id = $2`,
    [orgId, id]
  );
  if (docRes.rows.length === 0) {
    return null;
  }
  const pagesRes = await pool.query(
    `select page_number, text from document_pages
      where document_id = $1
      order by page_number asc`,
    [id]
  );
  return {
    extracted_text: docRes.rows[0].extracted_text
      ? String(docRes.rows[0].extracted_text)
      : null,
    pages: pagesRes.rows.map((r) => ({
      page_number: Number(r.page_number),
      text: r.text === null || r.text === undefined ? null : String(r.text),
    })),
  };
}

// Splits extracted text into naive "pages" (~3000 chars) so the detail view can
// present a page-by-page reader even for text-only uploads. Best-effort; skipped
// when text is empty.
export async function insertPages(
  pool: Pool,
  documentId: string,
  text: string,
  pageSize = 3000
): Promise<number> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  const chunks: string[] = [];
  for (let i = 0; i < trimmed.length; i += pageSize) {
    chunks.push(trimmed.slice(i, i + pageSize));
  }
  for (let idx = 0; idx < chunks.length; idx += 1) {
    await pool.query(
      `insert into document_pages (document_id, page_number, text)
       values ($1, $2, $3)
       on conflict (document_id, page_number) do update set text = excluded.text`,
      [documentId, idx + 1, chunks[idx]]
    );
  }
  return chunks.length;
}
