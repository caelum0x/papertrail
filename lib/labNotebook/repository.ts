import type { Pool } from "pg";
import type {
  CreateExperimentInput,
  LabExperimentListItem,
  LabExperimentRecord,
  StructuredExperiment,
} from "./schemas";

// Data access for the Lab Notebook. Every method is org-scoped: org_id is always the
// first predicate ($1) so a caller can never read, list or mutate another tenant's rows.
// Full-text search uses the stored `search` tsvector via websearch_to_tsquery.

// Raw DB row shape (snake_case) for a full record.
interface LabExperimentRow {
  id: string;
  org_id: string;
  created_by: string | null;
  title: string;
  experiment_date: Date | string | null;
  raw_notes: string;
  structured: StructuredExperiment;
  tags: string[] | null;
  created_at: Date | string;
}

// Raw DB row shape for a list item (no raw_notes / full structured payload).
interface LabExperimentListRow {
  id: string;
  title: string;
  experiment_date: Date | string | null;
  tags: string[] | null;
  created_at: Date | string;
  step_count: number;
  reagent_count: number;
  outcome_count: number;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// experiment_date is a DATE (no time). Keep just the YYYY-MM-DD portion.
function toDateString(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function mapRow(row: LabExperimentRow): LabExperimentRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    createdBy: row.created_by,
    title: row.title,
    experimentDate: toDateString(row.experiment_date),
    rawNotes: row.raw_notes,
    structured: row.structured,
    tags: row.tags ?? [],
    createdAt: toIso(row.created_at),
  };
}

function mapListRow(row: LabExperimentListRow): LabExperimentListItem {
  return {
    id: row.id,
    title: row.title,
    experimentDate: toDateString(row.experiment_date),
    tags: row.tags ?? [],
    createdAt: toIso(row.created_at),
    stepCount: Number(row.step_count) || 0,
    reagentCount: Number(row.reagent_count) || 0,
    outcomeCount: Number(row.outcome_count) || 0,
  };
}

export interface ListExperimentsOptions {
  q?: string;
  limit: number;
  offset: number;
}

/**
 * Persist a reviewed, grounded experiment record. org-scoped. `structured` is stored as
 * jsonb; the caller (route) has already re-validated it against StructuredExperimentSchema.
 */
export async function createExperiment(
  pool: Pool,
  orgId: string,
  userId: string | null,
  input: CreateExperimentInput
): Promise<LabExperimentRecord> {
  const { rows } = await pool.query<LabExperimentRow>(
    `insert into lab_experiments
       (org_id, created_by, title, experiment_date, raw_notes, structured, tags)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7)
     returning id, org_id, created_by, title, experiment_date, raw_notes,
               structured, tags, created_at`,
    [
      orgId,
      userId,
      input.title,
      input.experiment_date ?? null,
      input.raw_notes,
      JSON.stringify(input.structured),
      input.tags ?? [],
    ]
  );
  return mapRow(rows[0]);
}

// Roll-up counts computed from the structured jsonb so the list view can summarise an
// experiment without shipping the whole payload to the client.
const COUNT_EXPRS = `
  coalesce(jsonb_array_length(structured->'protocol_steps'), 0) as step_count,
  coalesce(jsonb_array_length(structured->'reagents'), 0) as reagent_count,
  coalesce(jsonb_array_length(structured->'outcomes'), 0) as outcome_count
`;

/**
 * List (or full-text search) an org's saved experiments. When `q` is present, ranks by
 * websearch_to_tsquery relevance against the stored `search` tsvector; otherwise returns
 * most-recent-first. Always org-scoped. Returns list items plus the total match count.
 */
export async function listExperiments(
  pool: Pool,
  orgId: string,
  options: ListExperimentsOptions
): Promise<{ items: LabExperimentListItem[]; total: number }> {
  const q = options.q?.trim();

  if (q) {
    const countResult = await pool.query<{ total: number }>(
      `select count(*)::int as total
         from lab_experiments
        where org_id = $1
          and search @@ websearch_to_tsquery('english', $2)`,
      [orgId, q]
    );
    const total = countResult.rows[0]?.total ?? 0;

    const listResult = await pool.query<LabExperimentListRow>(
      `select id, title, experiment_date, tags, created_at, ${COUNT_EXPRS}
         from lab_experiments
        where org_id = $1
          and search @@ websearch_to_tsquery('english', $2)
        order by ts_rank(search, websearch_to_tsquery('english', $2)) desc,
                 created_at desc
        limit $3 offset $4`,
      [orgId, q, options.limit, options.offset]
    );
    return { items: listResult.rows.map(mapListRow), total };
  }

  const countResult = await pool.query<{ total: number }>(
    `select count(*)::int as total from lab_experiments where org_id = $1`,
    [orgId]
  );
  const total = countResult.rows[0]?.total ?? 0;

  const listResult = await pool.query<LabExperimentListRow>(
    `select id, title, experiment_date, tags, created_at, ${COUNT_EXPRS}
       from lab_experiments
      where org_id = $1
      order by created_at desc
      limit $2 offset $3`,
    [orgId, options.limit, options.offset]
  );
  return { items: listResult.rows.map(mapListRow), total };
}

/** Fetch one full experiment record, org-scoped. Returns null if not found in this org. */
export async function getExperiment(
  pool: Pool,
  orgId: string,
  id: string
): Promise<LabExperimentRecord | null> {
  const { rows } = await pool.query<LabExperimentRow>(
    `select id, org_id, created_by, title, experiment_date, raw_notes,
            structured, tags, created_at
       from lab_experiments
      where org_id = $1 and id = $2`,
    [orgId, id]
  );
  if (rows.length === 0) return null;
  return mapRow(rows[0]);
}

/** Delete one experiment, org-scoped. Returns true if a row was removed. */
export async function deleteExperiment(
  pool: Pool,
  orgId: string,
  id: string
): Promise<boolean> {
  const result = await pool.query(
    `delete from lab_experiments where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return (result.rowCount ?? 0) > 0;
}
