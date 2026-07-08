import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import type { ExportFormat, ExportScope } from "@/lib/dataexport/schemas";
import {
  contentTypeFor,
  extensionFor,
  serialize,
  type Column,
  type Row,
} from "@/lib/dataexport/serialize";

// Builds org-scoped data exports. Each dataset fetcher binds org_id as a query
// parameter (never from client input directly) so one tenant can never read
// another's data, and returns { columns, rows } ready for the serializer. Column
// order is stable so exports are deterministic. Pure-ish: returns new rows,
// never mutates inputs.

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

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return value === null || value === undefined ? "" : String(value);
}

// Claims scoped to the org (optionally one project).
async function fetchClaims(
  q: ExportQuery,
  pool: Pool
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
    rows: rows.map((r) => ({ ...r, created_at: toIso(r.created_at) })),
  };
}

// Verifications scoped to the org via their linked claim. The legacy
// verifications table has no org_id, so we join through claims and filter on the
// claim's org.
async function fetchVerifications(
  q: ExportQuery,
  pool: Pool
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
    rows: rows.map((r) => ({ ...r, created_at: toIso(r.created_at) })),
  };
}

// Evidence items scoped to the org (optionally one project). tags is jsonb
// (array) — flatten to a comma-joined string for tabular output.
async function fetchEvidence(
  q: ExportQuery,
  pool: Pool
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

  const flattened: Row[] = rows.map((r) => ({
    id: r.id as string,
    source_type: r.source_type as string,
    external_id: (r.external_id as string | null) ?? "",
    title: r.title as string,
    url: (r.url as string | null) ?? "",
    notes: (r.notes as string | null) ?? "",
    tags: Array.isArray(r.tags) ? (r.tags as unknown[]).join(", ") : "",
    created_at: toIso(r.created_at),
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

// Documents scoped to the org (optionally one project). extracted_text is
// intentionally excluded — it can be huge and isn't useful in a tabular export.
async function fetchDocuments(
  q: ExportQuery,
  pool: Pool
): Promise<ExportDataset> {
  const values: unknown[] = [q.orgId];
  let where = "d.org_id = $1";
  if (q.projectId) {
    values.push(q.projectId);
    where += ` and d.project_id = $${values.length}`;
  }
  values.push(EXPORT_ROW_LIMIT);

  const { rows } = await pool.query<Row>(
    `select
        d.id,
        d.filename,
        d.mime_type,
        d.size_bytes,
        d.status,
        d.project_id,
        d.created_at
       from documents d
      where ${where}
      order by d.created_at desc
      limit $${values.length}`,
    values
  );

  return {
    columns: [
      { key: "id", label: "Document ID" },
      { key: "filename", label: "Filename" },
      { key: "mime_type", label: "MIME Type" },
      { key: "size_bytes", label: "Size (bytes)" },
      { key: "status", label: "Status" },
      { key: "project_id", label: "Project ID" },
      { key: "created_at", label: "Created At" },
    ],
    rows: rows.map((r) => ({ ...r, created_at: toIso(r.created_at) })),
  };
}

// References scoped to the org. authors is jsonb (array) — flatten to a
// comma-joined string. project_id lives on the reference_libraries parent, so
// project narrowing joins through the library.
async function fetchReferences(
  q: ExportQuery,
  pool: Pool
): Promise<ExportDataset> {
  const values: unknown[] = [q.orgId];
  let where = "r.org_id = $1";
  let join = "";
  if (q.projectId) {
    join = "join reference_libraries lib on lib.id = r.library_id";
    values.push(q.projectId);
    where += ` and lib.project_id = $${values.length}`;
  }
  values.push(EXPORT_ROW_LIMIT);

  const { rows } = await pool.query<Record<string, unknown>>(
    `select
        r.id,
        r.type,
        r.title,
        r.authors,
        r.year,
        r.journal,
        r.doi,
        r.pmid,
        r.nct_id,
        r.url,
        r.created_at
       from "references" r
       ${join}
      where ${where}
      order by r.created_at desc
      limit $${values.length}`,
    values
  );

  const flattened: Row[] = rows.map((r) => ({
    id: r.id as string,
    type: (r.type as string | null) ?? "",
    title: (r.title as string | null) ?? "",
    authors: Array.isArray(r.authors) ? (r.authors as unknown[]).join(", ") : "",
    year: (r.year as number | null) ?? "",
    journal: (r.journal as string | null) ?? "",
    doi: (r.doi as string | null) ?? "",
    pmid: (r.pmid as string | null) ?? "",
    nct_id: (r.nct_id as string | null) ?? "",
    url: (r.url as string | null) ?? "",
    created_at: toIso(r.created_at),
  }));

  return {
    columns: [
      { key: "id", label: "Reference ID" },
      { key: "type", label: "Type" },
      { key: "title", label: "Title" },
      { key: "authors", label: "Authors" },
      { key: "year", label: "Year" },
      { key: "journal", label: "Journal" },
      { key: "doi", label: "DOI" },
      { key: "pmid", label: "PMID" },
      { key: "nct_id", label: "NCT ID" },
      { key: "url", label: "URL" },
      { key: "created_at", label: "Created At" },
    ],
    rows: flattened,
  };
}

// Dispatches to the right dataset fetcher for a scope.
export async function fetchDataset(
  scope: ExportScope,
  q: ExportQuery,
  pool: Pool = getPool()
): Promise<ExportDataset> {
  switch (scope) {
    case "claims":
      return fetchClaims(q, pool);
    case "verifications":
      return fetchVerifications(q, pool);
    case "evidence":
      return fetchEvidence(q, pool);
    case "documents":
      return fetchDocuments(q, pool);
    case "references":
      return fetchReferences(q, pool);
    default: {
      // Exhaustiveness guard — unreachable given the ExportScope union.
      const _never: never = scope;
      throw new Error(`Unsupported export scope: ${String(_never)}`);
    }
  }
}

export interface BuiltExport {
  content: string;
  contentType: string;
  filename: string;
  rowCount: number;
}

// Fetches the org-scoped dataset for a scope, serializes it to the requested
// format, and returns the document plus metadata (content type, filename, row
// count). This is the single entry point the routes use to produce a downloadable
// export — deterministic given the same org/scope/format/params.
export async function buildExport(
  orgId: string,
  scope: ExportScope,
  format: ExportFormat,
  opts: { projectId?: string | null } = {},
  pool: Pool = getPool()
): Promise<BuiltExport> {
  const dataset = await fetchDataset(
    scope,
    { orgId, projectId: opts.projectId ?? null },
    pool
  );
  const content = serialize(format, dataset.rows, dataset.columns);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `papertrail-${scope}-${stamp}.${extensionFor(format)}`;
  return {
    content,
    contentType: contentTypeFor(format),
    filename,
    rowCount: dataset.rows.length,
  };
}
