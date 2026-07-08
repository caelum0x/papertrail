import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import { extractDocument } from "@/lib/ingestion/extractDocument";

// The document-processing pipeline. Given a document's raw bytes it:
//   1. extracts text page-by-page (via extractDocument — unpdf/Docling)
//   2. persists pages into document_pages
//   3. splits each page into overlapping-free chunks in document_chunks
//   4. records an extraction_jobs row tracking status/engine/pages/errors
// Everything is org-scoped: every row carries org_id and every query filters by it.

// Rows as returned to API clients. org_id is intentionally omitted (scoping is
// enforced server-side).
export type ExtractionJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface ExtractionJob {
  id: string;
  document_id: string;
  status: ExtractionJobStatus;
  engine: string | null;
  pages: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentChunk {
  id: string;
  document_id: string;
  page_number: number;
  chunk_index: number;
  text: string;
  created_at: string;
}

export interface PipelineSummary {
  job: ExtractionJob;
  engine: string;
  total_pages: number;
  page_count: number;
  chunk_count: number;
}

// Target chunk length in characters. Chosen so a single chunk fits comfortably in
// a retrieval/extraction prompt while keeping hundreds of pages tractable.
const CHUNK_SIZE = 1500;

function toJob(row: Record<string, unknown>): ExtractionJob {
  return {
    id: String(row.id),
    document_id: String(row.document_id),
    status: String(row.status) as ExtractionJobStatus,
    engine: row.engine ? String(row.engine) : null,
    pages: Number(row.pages ?? 0),
    error: row.error ? String(row.error) : null,
    created_at: new Date(row.created_at as string).toISOString(),
    updated_at: new Date(row.updated_at as string).toISOString(),
  };
}

function toChunk(row: Record<string, unknown>): DocumentChunk {
  return {
    id: String(row.id),
    document_id: String(row.document_id),
    page_number: Number(row.page_number),
    chunk_index: Number(row.chunk_index),
    text: String(row.text),
    created_at: new Date(row.created_at as string).toISOString(),
  };
}

// Splits a page's text into fixed-size chunks. Best-effort: prefers to break on a
// whitespace boundary near the target size so chunks don't slice words in half.
function chunkText(text: string, size = CHUNK_SIZE): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    let end = Math.min(start + size, trimmed.length);
    if (end < trimmed.length) {
      const window = trimmed.slice(start, end);
      const lastBreak = window.lastIndexOf(" ");
      if (lastBreak > size * 0.6) {
        end = start + lastBreak;
      }
    }
    const piece = trimmed.slice(start, end).trim();
    if (piece.length > 0) {
      chunks.push(piece);
    }
    start = end;
  }
  return chunks;
}

// Normalizes extractDocument output into a list of { pageNumber, text }. Docling
// returns a single fullText with no per-page split, so we synthesize pseudo-pages
// from fullText in that case (~3000 chars each) to keep a page-oriented viewer.
function normalizePages(extraction: {
  fullText: string;
  pages: { pageNumber: number; text: string }[];
}): { pageNumber: number; text: string }[] {
  if (extraction.pages.length > 0) {
    return extraction.pages;
  }
  const full = extraction.fullText.trim();
  if (full.length === 0) {
    return [];
  }
  const PSEUDO_PAGE = 3000;
  const pages: { pageNumber: number; text: string }[] = [];
  let pageNumber = 1;
  for (let i = 0; i < full.length; i += PSEUDO_PAGE) {
    pages.push({ pageNumber, text: full.slice(i, i + PSEUDO_PAGE) });
    pageNumber += 1;
  }
  return pages;
}

export async function createJob(
  pool: Pool,
  orgId: string,
  documentId: string
): Promise<ExtractionJob> {
  const res = await pool.query(
    `insert into extraction_jobs (org_id, document_id, status)
     values ($1, $2, 'pending')
     returning id, document_id, status, engine, pages, error, created_at, updated_at`,
    [orgId, documentId]
  );
  return toJob(res.rows[0]);
}

async function markJob(
  pool: Pool,
  orgId: string,
  jobId: string,
  fields: {
    status: ExtractionJobStatus;
    engine?: string | null;
    pages?: number;
    error?: string | null;
  }
): Promise<ExtractionJob> {
  const res = await pool.query(
    `update extraction_jobs
        set status = $3,
            engine = coalesce($4, engine),
            pages = coalesce($5, pages),
            error = $6,
            updated_at = now()
      where org_id = $1 and id = $2
      returning id, document_id, status, engine, pages, error, created_at, updated_at`,
    [
      orgId,
      jobId,
      fields.status,
      fields.engine ?? null,
      fields.pages ?? null,
      fields.error ?? null,
    ]
  );
  return toJob(res.rows[0]);
}

// Loads the document bytes/text to run the pipeline over. The documents module
// stores extracted_text for inline uploads (no real blob store yet), so we
// synthesize a text-only extraction from that when there are no stored bytes.
async function loadDocumentText(
  pool: Pool,
  orgId: string,
  documentId: string
): Promise<string | null> {
  const res = await pool.query(
    `select extracted_text from documents where org_id = $1 and id = $2`,
    [orgId, documentId]
  );
  if (res.rows.length === 0) {
    return null;
  }
  return res.rows[0].extracted_text ? String(res.rows[0].extracted_text) : "";
}

/**
 * Runs the full extraction pipeline for a stored document.
 *
 * If `bytes` are supplied (a real PDF upload) they are run through
 * extractDocument. Otherwise the pipeline falls back to the document's already
 * stored extracted_text (inline text uploads) so the same pipeline powers both
 * paths. Returns a summary and always leaves an extraction_jobs row reflecting
 * the final status. Throws only if the document itself cannot be found.
 */
export async function processDocument(
  bytes: Uint8Array | Buffer | null,
  documentId: string,
  orgId: string
): Promise<PipelineSummary> {
  const pool = getPool();

  const job = await createJob(pool, orgId, documentId);

  try {
    await markJob(pool, orgId, job.id, { status: "processing" });

    let engine = "unpdf";
    let totalPages = 0;
    let pages: { pageNumber: number; text: string }[];

    if (bytes && bytes.length > 0) {
      const extraction = await extractDocument(bytes);
      engine = extraction.engine;
      totalPages = extraction.totalPages ?? 0;
      pages = normalizePages(extraction);
    } else {
      const text = await loadDocumentText(pool, orgId, documentId);
      if (text === null) {
        throw new Error("Document not found.");
      }
      engine = "stored-text";
      pages = normalizePages({ fullText: text, pages: [] });
      totalPages = pages.length;
    }

    const { pageCount, chunkCount } = await persistPagesAndChunks(
      pool,
      orgId,
      documentId,
      pages
    );

    const finalJob = await markJob(pool, orgId, job.id, {
      status: "completed",
      engine,
      pages: pageCount,
      error: null,
    });

    await pool.query(
      `update documents
          set status = 'extracted', updated_at = now()
        where org_id = $1 and id = $2`,
      [orgId, documentId]
    );

    return {
      job: finalJob,
      engine,
      total_pages: totalPages || pageCount,
      page_count: pageCount,
      chunk_count: chunkCount,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Extraction failed.";
    await markJob(pool, orgId, job.id, { status: "failed", error: message });
    await pool.query(
      `update documents set status = 'failed', updated_at = now()
        where org_id = $1 and id = $2`,
      [orgId, documentId]
    );
    throw err;
  }
}

// Replaces any existing pages/chunks for the document, then writes the new ones.
// Idempotent per run so re-extracting a document doesn't leave stale rows.
async function persistPagesAndChunks(
  pool: Pool,
  orgId: string,
  documentId: string,
  pages: { pageNumber: number; text: string }[]
): Promise<{ pageCount: number; chunkCount: number }> {
  await pool.query(
    `delete from document_chunks where org_id = $1 and document_id = $2`,
    [orgId, documentId]
  );
  await pool.query(`delete from document_pages where document_id = $1`, [
    documentId,
  ]);

  let chunkIndex = 0;
  let pageCount = 0;

  for (const page of pages) {
    const pageText = page.text ?? "";
    await pool.query(
      `insert into document_pages (document_id, page_number, text)
       values ($1, $2, $3)
       on conflict (document_id, page_number) do update set text = excluded.text`,
      [documentId, page.pageNumber, pageText]
    );
    pageCount += 1;

    for (const piece of chunkText(pageText)) {
      await pool.query(
        `insert into document_chunks
           (org_id, document_id, page_number, chunk_index, text)
         values ($1, $2, $3, $4, $5)
         on conflict (document_id, chunk_index) do update set
           text = excluded.text, page_number = excluded.page_number`,
        [orgId, documentId, page.pageNumber, chunkIndex, piece]
      );
      chunkIndex += 1;
    }
  }

  return { pageCount, chunkCount: chunkIndex };
}

export async function listChunks(
  pool: Pool,
  orgId: string,
  documentId: string,
  opts: { limit: number; offset: number }
): Promise<{ chunks: DocumentChunk[]; total: number }> {
  const countRes = await pool.query(
    `select count(*)::int as total from document_chunks
      where org_id = $1 and document_id = $2`,
    [orgId, documentId]
  );
  const total = Number(countRes.rows[0]?.total ?? 0);

  const rowsRes = await pool.query(
    `select id, document_id, page_number, chunk_index, text, created_at
       from document_chunks
      where org_id = $1 and document_id = $2
      order by chunk_index asc
      limit $3 offset $4`,
    [orgId, documentId, opts.limit, opts.offset]
  );
  return { chunks: rowsRes.rows.map(toChunk), total };
}

export async function listJobs(
  pool: Pool,
  orgId: string,
  opts: { limit: number; offset: number; documentId?: string | null }
): Promise<{ jobs: ExtractionJob[]; total: number }> {
  const params: unknown[] = [orgId];
  let where = "org_id = $1";
  if (opts.documentId) {
    params.push(opts.documentId);
    where += ` and document_id = $${params.length}`;
  }

  const countRes = await pool.query(
    `select count(*)::int as total from extraction_jobs where ${where}`,
    params
  );
  const total = Number(countRes.rows[0]?.total ?? 0);

  params.push(opts.limit, opts.offset);
  const rowsRes = await pool.query(
    `select id, document_id, status, engine, pages, error, created_at, updated_at
       from extraction_jobs
      where ${where}
      order by created_at desc
      limit $${params.length - 1} offset $${params.length}`,
    params
  );
  return { jobs: rowsRes.rows.map(toJob), total };
}

export async function getLatestJob(
  pool: Pool,
  orgId: string,
  documentId: string
): Promise<ExtractionJob | null> {
  const res = await pool.query(
    `select id, document_id, status, engine, pages, error, created_at, updated_at
       from extraction_jobs
      where org_id = $1 and document_id = $2
      order by created_at desc
      limit 1`,
    [orgId, documentId]
  );
  return res.rows.length > 0 ? toJob(res.rows[0]) : null;
}

// Verifies a document belongs to the org before running document-scoped work.
export async function documentExists(
  pool: Pool,
  orgId: string,
  documentId: string
): Promise<boolean> {
  const res = await pool.query(
    `select 1 from documents where org_id = $1 and id = $2`,
    [orgId, documentId]
  );
  return res.rows.length > 0;
}
