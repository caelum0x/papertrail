import type { Pool } from "pg";
import type {
  Reference,
  ReferenceLibrary,
  ParsedReference,
} from "@/lib/references/types";

// Data-access layer for the Reference manager. Every query is org-scoped: callers
// pass ctx.org.id so a tenant can never read or mutate another tenant's rows.
// Note: `references` is a SQL reserved word, so the table is always quoted.

interface LibraryRow {
  id: string;
  org_id: string;
  project_id: string | null;
  name: string;
  reference_count?: string | number | null;
  created_at: Date | string;
}

interface ReferenceRow {
  id: string;
  org_id: string;
  library_id: string;
  type: string;
  title: string | null;
  authors: unknown;
  year: number | null;
  journal: string | null;
  doi: string | null;
  pmid: string | null;
  nct_id: string | null;
  url: string | null;
  raw: unknown;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapLibrary(row: LibraryRow): ReferenceLibrary {
  const lib: ReferenceLibrary = {
    id: row.id,
    orgId: row.org_id,
    projectId: row.project_id,
    name: row.name,
    createdAt: toIso(row.created_at),
  };
  if (row.reference_count !== undefined && row.reference_count !== null) {
    lib.referenceCount = Number(row.reference_count);
  }
  return lib;
}

function mapReference(row: ReferenceRow): Reference {
  return {
    id: row.id,
    orgId: row.org_id,
    libraryId: row.library_id,
    type: row.type,
    title: row.title,
    authors: toStringArray(row.authors),
    year: row.year,
    journal: row.journal,
    doi: row.doi,
    pmid: row.pmid,
    nctId: row.nct_id,
    url: row.url,
    raw: toRecord(row.raw),
    createdAt: toIso(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// Libraries
// ---------------------------------------------------------------------------

export async function countLibraries(pool: Pool, orgId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::int as count from reference_libraries where org_id = $1`,
    [orgId]
  );
  return Number(rows[0]?.count ?? 0);
}

export async function listLibraries(
  pool: Pool,
  orgId: string,
  limit: number,
  offset: number
): Promise<ReferenceLibrary[]> {
  const { rows } = await pool.query<LibraryRow>(
    `select l.id, l.org_id, l.project_id, l.name, l.created_at,
            count(r.id)::int as reference_count
       from reference_libraries l
       left join "references" r on r.library_id = l.id
      where l.org_id = $1
      group by l.id
      order by l.created_at desc
      limit $2 offset $3`,
    [orgId, limit, offset]
  );
  return rows.map(mapLibrary);
}

export async function getLibrary(
  pool: Pool,
  orgId: string,
  libraryId: string
): Promise<ReferenceLibrary | null> {
  const { rows } = await pool.query<LibraryRow>(
    `select l.id, l.org_id, l.project_id, l.name, l.created_at,
            count(r.id)::int as reference_count
       from reference_libraries l
       left join "references" r on r.library_id = l.id
      where l.org_id = $1 and l.id = $2
      group by l.id`,
    [orgId, libraryId]
  );
  return rows[0] ? mapLibrary(rows[0]) : null;
}

// Confirms a project belongs to the org before we attach a library to it.
export async function isOrgProject(
  pool: Pool,
  orgId: string,
  projectId: string
): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `select exists(
       select 1 from projects where org_id = $1 and id = $2
     ) as exists`,
    [orgId, projectId]
  );
  return Boolean(rows[0]?.exists);
}

export async function createLibrary(
  pool: Pool,
  input: { orgId: string; name: string; projectId: string | null }
): Promise<ReferenceLibrary> {
  const { rows } = await pool.query<LibraryRow>(
    `insert into reference_libraries (org_id, name, project_id)
     values ($1, $2, $3)
     returning id, org_id, project_id, name, created_at`,
    [input.orgId, input.name, input.projectId]
  );
  return mapLibrary(rows[0]);
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

export async function countReferences(
  pool: Pool,
  orgId: string,
  filters: { libraryId?: string; search?: string }
): Promise<number> {
  const params: unknown[] = [orgId];
  let where = "org_id = $1";
  if (filters.libraryId) {
    params.push(filters.libraryId);
    where += ` and library_id = $${params.length}`;
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where += ` and title ilike $${params.length}`;
  }
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::int as count from "references" where ${where}`,
    params
  );
  return Number(rows[0]?.count ?? 0);
}

export async function listReferences(
  pool: Pool,
  orgId: string,
  filters: { libraryId?: string; search?: string },
  limit: number,
  offset: number
): Promise<Reference[]> {
  const params: unknown[] = [orgId];
  let where = "org_id = $1";
  if (filters.libraryId) {
    params.push(filters.libraryId);
    where += ` and library_id = $${params.length}`;
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where += ` and title ilike $${params.length}`;
  }
  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const { rows } = await pool.query<ReferenceRow>(
    `select id, org_id, library_id, type, title, authors, year, journal,
            doi, pmid, nct_id, url, raw, created_at
       from "references"
      where ${where}
      order by created_at desc
      limit $${limitIdx} offset $${offsetIdx}`,
    params
  );
  return rows.map(mapReference);
}

// Fetches all references in a library (no pagination) for export.
export async function listAllReferencesForExport(
  pool: Pool,
  orgId: string,
  libraryId: string
): Promise<Reference[]> {
  const { rows } = await pool.query<ReferenceRow>(
    `select id, org_id, library_id, type, title, authors, year, journal,
            doi, pmid, nct_id, url, raw, created_at
       from "references"
      where org_id = $1 and library_id = $2
      order by created_at asc`,
    [orgId, libraryId]
  );
  return rows.map(mapReference);
}

export async function getReference(
  pool: Pool,
  orgId: string,
  referenceId: string
): Promise<Reference | null> {
  const { rows } = await pool.query<ReferenceRow>(
    `select id, org_id, library_id, type, title, authors, year, journal,
            doi, pmid, nct_id, url, raw, created_at
       from "references"
      where org_id = $1 and id = $2`,
    [orgId, referenceId]
  );
  return rows[0] ? mapReference(rows[0]) : null;
}

export async function createReference(
  pool: Pool,
  input: { orgId: string; libraryId: string } & ParsedReference
): Promise<Reference> {
  const { rows } = await pool.query<ReferenceRow>(
    `insert into "references"
       (org_id, library_id, type, title, authors, year, journal, doi, pmid, nct_id, url, raw)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12::jsonb)
     returning id, org_id, library_id, type, title, authors, year, journal,
               doi, pmid, nct_id, url, raw, created_at`,
    [
      input.orgId,
      input.libraryId,
      input.type,
      input.title,
      JSON.stringify(input.authors ?? []),
      input.year,
      input.journal,
      input.doi,
      input.pmid,
      input.nctId,
      input.url,
      JSON.stringify(input.raw ?? {}),
    ]
  );
  return mapReference(rows[0]);
}

// Bulk-insert parsed references into a library in a single transaction. Returns
// the count inserted. All rows share org_id/library_id.
export async function bulkCreateReferences(
  pool: Pool,
  input: { orgId: string; libraryId: string; references: ParsedReference[] }
): Promise<number> {
  if (input.references.length === 0) return 0;
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const ref of input.references) {
      await client.query(
        `insert into "references"
           (org_id, library_id, type, title, authors, year, journal, doi, pmid, nct_id, url, raw)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
        [
          input.orgId,
          input.libraryId,
          ref.type,
          ref.title,
          JSON.stringify(ref.authors ?? []),
          ref.year,
          ref.journal,
          ref.doi,
          ref.pmid,
          ref.nctId,
          ref.url,
          JSON.stringify(ref.raw ?? {}),
        ]
      );
    }
    await client.query("commit");
    return input.references.length;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateReference(
  pool: Pool,
  orgId: string,
  referenceId: string,
  patch: {
    type?: string;
    title?: string | null;
    authors?: string[];
    year?: number | null;
    journal?: string | null;
    doi?: string | null;
    pmid?: string | null;
    nctId?: string | null;
    url?: string | null;
  }
): Promise<Reference | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (patch.type !== undefined) {
    sets.push(`type = $${i++}`);
    values.push(patch.type);
  }
  if (patch.title !== undefined) {
    sets.push(`title = $${i++}`);
    values.push(patch.title);
  }
  if (patch.authors !== undefined) {
    sets.push(`authors = $${i++}::jsonb`);
    values.push(JSON.stringify(patch.authors));
  }
  if (patch.year !== undefined) {
    sets.push(`year = $${i++}`);
    values.push(patch.year);
  }
  if (patch.journal !== undefined) {
    sets.push(`journal = $${i++}`);
    values.push(patch.journal);
  }
  if (patch.doi !== undefined) {
    sets.push(`doi = $${i++}`);
    values.push(patch.doi);
  }
  if (patch.pmid !== undefined) {
    sets.push(`pmid = $${i++}`);
    values.push(patch.pmid);
  }
  if (patch.nctId !== undefined) {
    sets.push(`nct_id = $${i++}`);
    values.push(patch.nctId);
  }
  if (patch.url !== undefined) {
    sets.push(`url = $${i++}`);
    values.push(patch.url);
  }

  if (sets.length === 0) {
    return getReference(pool, orgId, referenceId);
  }

  values.push(orgId, referenceId);
  const { rows } = await pool.query<ReferenceRow>(
    `update "references" set ${sets.join(", ")}
      where org_id = $${i++} and id = $${i}
      returning id, org_id, library_id, type, title, authors, year, journal,
                doi, pmid, nct_id, url, raw, created_at`,
    values
  );
  return rows[0] ? mapReference(rows[0]) : null;
}

export async function deleteReference(
  pool: Pool,
  orgId: string,
  referenceId: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `delete from "references" where org_id = $1 and id = $2`,
    [orgId, referenceId]
  );
  return (rowCount ?? 0) > 0;
}
