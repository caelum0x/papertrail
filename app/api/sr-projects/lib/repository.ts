import type { Pool } from "pg";
import type {
  PrismaCounts,
  ScreeningDecision,
  ScreeningStage,
  SrProject,
  SrProjectStatus,
  SrProjectWithCounts,
  SrRecord,
  SrRecordStatus,
  SrSourceType,
} from "./types";

// Data access for the systematic-review module. Every method is org-scoped:
// org_id is always the first predicate so a caller can never read or mutate
// another tenant's rows.

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// --- sr_projects ---------------------------------------------------------

interface SrProjectRow {
  id: string;
  org_id: string;
  project_id: string | null;
  name: string;
  question: string;
  inclusion_criteria: unknown;
  status: SrProjectStatus;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function parseCriteria(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

function mapProject(row: SrProjectRow): SrProject {
  return {
    id: row.id,
    orgId: row.org_id,
    projectId: row.project_id,
    name: row.name,
    question: row.question,
    inclusionCriteria: parseCriteria(row.inclusion_criteria),
    status: row.status,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

interface SrProjectCountRow extends SrProjectRow {
  record_count: number | string;
  pending_count: number | string;
}

function mapProjectWithCounts(row: SrProjectCountRow): SrProjectWithCounts {
  return {
    ...mapProject(row),
    recordCount: Number(row.record_count) || 0,
    pendingCount: Number(row.pending_count) || 0,
  };
}

const SELECT_PROJECT_WITH_COUNTS = `
  select p.*,
         (select count(*) from sr_records r where r.sr_project_id = p.id) as record_count,
         (select count(*) from sr_records r
            where r.sr_project_id = p.id and r.status = 'pending') as pending_count
    from sr_projects p
`;

export interface ListSrProjectsFilters {
  orgId: string;
  status?: SrProjectStatus;
  limit: number;
  offset: number;
}

export async function listSrProjects(
  pool: Pool,
  filters: ListSrProjectsFilters
): Promise<{ items: SrProjectWithCounts[]; total: number }> {
  const conditions: string[] = ["p.org_id = $1"];
  const params: unknown[] = [filters.orgId];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`p.status = $${params.length}`);
  }
  const where = conditions.join(" and ");

  const countResult = await pool.query<{ total: number }>(
    `select count(*)::int as total from sr_projects p where ${where}`,
    params
  );
  const total = countResult.rows[0]?.total ?? 0;

  const listResult = await pool.query<SrProjectCountRow>(
    `${SELECT_PROJECT_WITH_COUNTS}
      where ${where}
      order by p.created_at desc
      limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, filters.limit, filters.offset]
  );

  return { items: listResult.rows.map(mapProjectWithCounts), total };
}

export interface CreateSrProjectData {
  orgId: string;
  projectId: string | null;
  name: string;
  question: string;
  inclusionCriteria: string[];
  createdBy: string | null;
}

export async function createSrProject(
  pool: Pool,
  data: CreateSrProjectData
): Promise<SrProjectWithCounts> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into sr_projects
       (org_id, project_id, name, question, inclusion_criteria, created_by)
     values ($1, $2, $3, $4, $5::jsonb, $6)
     returning id`,
    [
      data.orgId,
      data.projectId,
      data.name,
      data.question,
      JSON.stringify(data.inclusionCriteria),
      data.createdBy,
    ]
  );
  const created = await getSrProject(pool, data.orgId, rows[0].id);
  return created as SrProjectWithCounts;
}

export async function getSrProject(
  pool: Pool,
  orgId: string,
  id: string
): Promise<SrProjectWithCounts | null> {
  const { rows } = await pool.query<SrProjectCountRow>(
    `${SELECT_PROJECT_WITH_COUNTS} where p.org_id = $1 and p.id = $2 limit 1`,
    [orgId, id]
  );
  return rows[0] ? mapProjectWithCounts(rows[0]) : null;
}

export interface UpdateSrProjectData {
  name?: string;
  question?: string;
  inclusionCriteria?: string[];
  status?: SrProjectStatus;
}

export async function updateSrProject(
  pool: Pool,
  orgId: string,
  id: string,
  data: UpdateSrProjectData
): Promise<SrProjectWithCounts | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (data.name !== undefined) {
    params.push(data.name);
    sets.push(`name = $${params.length}`);
  }
  if (data.question !== undefined) {
    params.push(data.question);
    sets.push(`question = $${params.length}`);
  }
  if (data.inclusionCriteria !== undefined) {
    params.push(JSON.stringify(data.inclusionCriteria));
    sets.push(`inclusion_criteria = $${params.length}::jsonb`);
  }
  if (data.status !== undefined) {
    params.push(data.status);
    sets.push(`status = $${params.length}`);
  }

  if (sets.length === 0) {
    return getSrProject(pool, orgId, id);
  }

  sets.push("updated_at = now()");
  params.push(orgId);
  const orgParam = params.length;
  params.push(id);
  const idParam = params.length;

  const { rowCount } = await pool.query(
    `update sr_projects set ${sets.join(", ")}
      where org_id = $${orgParam} and id = $${idParam}`,
    params
  );
  if (!rowCount) return null;
  return getSrProject(pool, orgId, id);
}

// --- sr_records ----------------------------------------------------------

interface SrRecordRow {
  id: string;
  org_id: string;
  sr_project_id: string;
  source_type: SrSourceType;
  external_id: string | null;
  title: string;
  abstract: string | null;
  status: SrRecordStatus;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapRecord(row: SrRecordRow): SrRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    srProjectId: row.sr_project_id,
    sourceType: row.source_type,
    externalId: row.external_id,
    title: row.title,
    abstract: row.abstract,
    status: row.status,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export interface RecordInput {
  sourceType: SrSourceType;
  externalId: string | null;
  title: string;
  abstract: string | null;
}

// Imports candidate records into a review. On-conflict (same source+external_id
// within the project) rows are skipped so re-importing is idempotent; the return
// value reports how many were inserted vs. skipped as duplicates.
export async function importRecords(
  pool: Pool,
  orgId: string,
  srProjectId: string,
  createdBy: string | null,
  records: RecordInput[]
): Promise<{ imported: number; duplicates: number }> {
  let imported = 0;
  for (const rec of records) {
    const { rowCount } = await pool.query(
      `insert into sr_records
         (org_id, sr_project_id, source_type, external_id, title, abstract, created_by)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (sr_project_id, source_type, external_id)
         where external_id is not null
         do nothing`,
      [
        orgId,
        srProjectId,
        rec.sourceType,
        rec.externalId,
        rec.title,
        rec.abstract,
        createdBy,
      ]
    );
    imported += rowCount ?? 0;
  }
  return { imported, duplicates: records.length - imported };
}

export interface ListRecordsFilters {
  orgId: string;
  srProjectId: string;
  status?: SrRecordStatus;
  limit: number;
  offset: number;
}

export async function listRecords(
  pool: Pool,
  filters: ListRecordsFilters
): Promise<{ items: SrRecord[]; total: number }> {
  const conditions: string[] = ["org_id = $1", "sr_project_id = $2"];
  const params: unknown[] = [filters.orgId, filters.srProjectId];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.join(" and ");

  const countResult = await pool.query<{ total: number }>(
    `select count(*)::int as total from sr_records where ${where}`,
    params
  );
  const total = countResult.rows[0]?.total ?? 0;

  const listResult = await pool.query<SrRecordRow>(
    `select * from sr_records
      where ${where}
      order by
        case when status = 'pending' then 0 else 1 end,
        created_at asc
      limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, filters.limit, filters.offset]
  );

  return { items: listResult.rows.map(mapRecord), total };
}

export async function getRecord(
  pool: Pool,
  orgId: string,
  id: string
): Promise<SrRecord | null> {
  const { rows } = await pool.query<SrRecordRow>(
    `select * from sr_records where org_id = $1 and id = $2 limit 1`,
    [orgId, id]
  );
  return rows[0] ? mapRecord(rows[0]) : null;
}

// The record status that results from a screening decision at a given stage.
// Title/abstract include advances the record to full-text; full-text include is
// the final "included" state. Excludes are terminal at their stage.
export function nextStatus(
  stage: ScreeningStage,
  decision: ScreeningDecision
): SrRecordStatus {
  if (stage === "title_abstract") {
    return decision === "include" ? "title_included" : "title_excluded";
  }
  return decision === "include" ? "fulltext_included" : "fulltext_excluded";
}

// Records a screening decision and advances the record's status atomically.
// Returns the updated record, or null if the record does not exist in the org.
export async function screenRecord(
  pool: Pool,
  orgId: string,
  recordId: string,
  reviewerId: string | null,
  stage: ScreeningStage,
  decision: ScreeningDecision,
  reason: string | null
): Promise<SrRecord | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const existing = await client.query<SrRecordRow>(
      `select * from sr_records where org_id = $1 and id = $2 for update`,
      [orgId, recordId]
    );
    if (existing.rows.length === 0) {
      await client.query("rollback");
      return null;
    }

    await client.query(
      `insert into screening_decisions
         (org_id, sr_record_id, reviewer_id, stage, decision, reason)
       values ($1, $2, $3, $4, $5, $6)`,
      [orgId, recordId, reviewerId, stage, decision, reason]
    );

    const status = nextStatus(stage, decision);
    const updated = await client.query<SrRecordRow>(
      `update sr_records
          set status = $1, updated_at = now()
        where org_id = $2 and id = $3
        returning *`,
      [status, orgId, recordId]
    );

    await client.query("commit");
    return updated.rows[0] ? mapRecord(updated.rows[0]) : null;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// --- PRISMA aggregation --------------------------------------------------

// Computes PRISMA flow-diagram counts for a review from record statuses and the
// full-text exclusion reasons. Records that never reached a stage are counted at
// the earliest stage they belong to.
export async function getPrismaCounts(
  pool: Pool,
  orgId: string,
  srProjectId: string
): Promise<PrismaCounts> {
  const statusResult = await pool.query<{ status: SrRecordStatus; count: string }>(
    `select status, count(*)::int as count
       from sr_records
      where org_id = $1 and sr_project_id = $2
      group by status`,
    [orgId, srProjectId]
  );

  const byStatus: Record<SrRecordStatus, number> = {
    pending: 0,
    title_included: 0,
    title_excluded: 0,
    fulltext_included: 0,
    fulltext_excluded: 0,
  };
  for (const row of statusResult.rows) {
    byStatus[row.status] = Number(row.count) || 0;
  }

  const identified =
    byStatus.pending +
    byStatus.title_included +
    byStatus.title_excluded +
    byStatus.fulltext_included +
    byStatus.fulltext_excluded;

  // Title/abstract screening covers every record that has left 'pending'.
  const titleExcluded = byStatus.title_excluded;
  const titleScreened =
    byStatus.title_included +
    byStatus.title_excluded +
    byStatus.fulltext_included +
    byStatus.fulltext_excluded;

  // Full-text assessment covers records that passed title screening.
  const fullTextAssessed =
    byStatus.fulltext_included + byStatus.fulltext_excluded;
  const fullTextExcluded = byStatus.fulltext_excluded;
  const included = byStatus.fulltext_included;

  const reasonResult = await pool.query<{ reason: string | null; count: string }>(
    `select d.reason, count(*)::int as count
       from screening_decisions d
       join sr_records r on r.id = d.sr_record_id
      where d.org_id = $1
        and r.sr_project_id = $2
        and d.stage = 'full_text'
        and d.decision = 'exclude'
      group by d.reason
      order by count(*) desc`,
    [orgId, srProjectId]
  );

  const fullTextExclusionReasons = reasonResult.rows.map((row) => ({
    reason: row.reason && row.reason.trim() ? row.reason : "Unspecified",
    count: Number(row.count) || 0,
  }));

  return {
    identified,
    // No dedup pass is modelled yet (imports skip exact upstream duplicates at
    // insert time); surfaced as 0 so the PRISMA box is present and honest.
    duplicatesRemoved: 0,
    titleScreened,
    titleExcluded,
    fullTextAssessed,
    fullTextExcluded,
    included,
    fullTextExclusionReasons,
  };
}
