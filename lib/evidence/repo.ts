import { getPool } from "@/lib/db";
import type { EvidenceItem, EvidenceSourceType } from "@/lib/evidence/types";
import type {
  CreateEvidenceInput,
  UpdateEvidenceInput,
} from "@/lib/evidence/schemas";

// Repository for evidence_items. Every query is org-scoped: the caller passes
// ctx.org.id and all reads/writes filter by it so tenants never see each other's
// data. Parameterized queries only — never interpolate user input into SQL.

const SELECT_COLUMNS = `id, org_id, project_id, source_type, external_id,
  title, url, notes, tags, added_by, created_at`;

interface EvidenceRow {
  id: string;
  org_id: string;
  project_id: string | null;
  source_type: EvidenceSourceType;
  external_id: string | null;
  title: string;
  url: string | null;
  notes: string | null;
  tags: unknown;
  added_by: string | null;
  created_at: string;
}

function normalizeTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((t): t is string => typeof t === "string");
  }
  return [];
}

function mapRow(row: EvidenceRow): EvidenceItem {
  return {
    id: row.id,
    org_id: row.org_id,
    project_id: row.project_id,
    source_type: row.source_type,
    external_id: row.external_id,
    title: row.title,
    url: row.url,
    notes: row.notes,
    tags: normalizeTags(row.tags),
    added_by: row.added_by,
    created_at: row.created_at,
  };
}

export interface ListEvidenceParams {
  orgId: string;
  limit: number;
  offset: number;
  q?: string;
  sourceType?: EvidenceSourceType;
  tag?: string;
  projectId?: string;
}

export interface ListEvidenceResult {
  items: EvidenceItem[];
  total: number;
}

interface CountRow {
  count: string;
}

export async function listEvidence(
  params: ListEvidenceParams
): Promise<ListEvidenceResult> {
  const pool = getPool();
  const conditions: string[] = ["org_id = $1"];
  const values: unknown[] = [params.orgId];

  if (params.q) {
    values.push(`%${params.q}%`);
    const idx = `$${values.length}`;
    conditions.push(
      `(title ILIKE ${idx} OR external_id ILIKE ${idx} OR notes ILIKE ${idx})`
    );
  }
  if (params.sourceType) {
    values.push(params.sourceType);
    conditions.push(`source_type = $${values.length}`);
  }
  if (params.projectId) {
    values.push(params.projectId);
    conditions.push(`project_id = $${values.length}`);
  }
  if (params.tag) {
    // Case-insensitive membership test against the jsonb tags array.
    values.push(params.tag.toLowerCase());
    conditions.push(
      `exists (select 1 from jsonb_array_elements_text(tags) t
         where lower(t) = $${values.length})`
    );
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const listValues = [...values, params.limit, params.offset];
  const limitIdx = `$${values.length + 1}`;
  const offsetIdx = `$${values.length + 2}`;

  const [itemsResult, countResult] = await Promise.all([
    pool.query<EvidenceRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM evidence_items
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ${limitIdx} OFFSET ${offsetIdx}`,
      listValues
    ),
    pool.query<CountRow>(
      `SELECT count(*) AS count FROM evidence_items ${whereClause}`,
      values
    ),
  ]);

  return {
    items: itemsResult.rows.map(mapRow),
    total: Number(countResult.rows[0]?.count ?? 0),
  };
}

export async function getEvidenceById(
  orgId: string,
  id: string
): Promise<EvidenceItem | null> {
  const pool = getPool();
  const { rows } = await pool.query<EvidenceRow>(
    `SELECT ${SELECT_COLUMNS}
     FROM evidence_items
     WHERE org_id = $1 AND id = $2`,
    [orgId, id]
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export interface CreateEvidenceParams extends CreateEvidenceInput {
  orgId: string;
  addedBy: string | null;
}

export async function createEvidence(
  params: CreateEvidenceParams
): Promise<EvidenceItem> {
  const pool = getPool();
  const tags = params.tags ?? [];
  const { rows } = await pool.query<EvidenceRow>(
    `INSERT INTO evidence_items
       (org_id, project_id, source_type, external_id, title, url, notes, tags, added_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
     RETURNING ${SELECT_COLUMNS}`,
    [
      params.orgId,
      params.project_id ?? null,
      params.source_type,
      params.external_id ?? null,
      params.title,
      params.url ?? null,
      params.notes ?? null,
      JSON.stringify(tags),
      params.addedBy,
    ]
  );
  return mapRow(rows[0]);
}

export async function updateEvidence(
  orgId: string,
  id: string,
  patch: UpdateEvidenceInput
): Promise<EvidenceItem | null> {
  const pool = getPool();
  const sets: string[] = [];
  const values: unknown[] = [];

  const push = (column: string, value: unknown, cast = "") => {
    values.push(value);
    sets.push(`${column} = $${values.length}${cast}`);
  };

  if ("project_id" in patch) push("project_id", patch.project_id ?? null);
  if (patch.source_type !== undefined) push("source_type", patch.source_type);
  if ("external_id" in patch) push("external_id", patch.external_id ?? null);
  if (patch.title !== undefined) push("title", patch.title);
  if ("url" in patch) push("url", patch.url ?? null);
  if ("notes" in patch) push("notes", patch.notes ?? null);
  if (patch.tags !== undefined) {
    push("tags", JSON.stringify(patch.tags), "::jsonb");
  }

  if (sets.length === 0) {
    return getEvidenceById(orgId, id);
  }

  values.push(orgId, id);
  const orgIdx = `$${values.length - 1}`;
  const idIdx = `$${values.length}`;

  const { rows } = await pool.query<EvidenceRow>(
    `UPDATE evidence_items
     SET ${sets.join(", ")}
     WHERE org_id = ${orgIdx} AND id = ${idIdx}
     RETURNING ${SELECT_COLUMNS}`,
    values
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function deleteEvidence(
  orgId: string,
  id: string
): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `DELETE FROM evidence_items WHERE org_id = $1 AND id = $2`,
    [orgId, id]
  );
  return (rowCount ?? 0) > 0;
}

// Merges new tags into an item's existing tag set (case-insensitive dedupe).
export async function addEvidenceTags(
  orgId: string,
  id: string,
  newTags: string[]
): Promise<EvidenceItem | null> {
  const existing = await getEvidenceById(orgId, id);
  if (!existing) {
    return null;
  }
  const seen = new Set(existing.tags.map((t) => t.toLowerCase()));
  const merged = [...existing.tags];
  for (const tag of newTags) {
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(tag);
    }
  }
  return updateEvidence(orgId, id, { tags: merged });
}
