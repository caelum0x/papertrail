import type { Pool } from "pg";
import type {
  ReportDefinition,
  ReportFilters,
  ReportLayout,
  ReportResult,
  ReportRun,
  ReportType,
  ReportFormat,
  RunStatus,
  ScheduledReport,
} from "@/lib/reporting/types";

// Data-access layer for the Reporting engine. Every query is org-scoped: callers
// pass ctx.org.id so a tenant can never read or mutate another tenant's rows.

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function asLayout(raw: unknown): ReportLayout {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sections = Array.isArray(obj.sections)
    ? (obj.sections as ReportLayout["sections"])
    : [];
  return { sections };
}

function asFilters(raw: unknown): ReportFilters {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const filters = Array.isArray(obj.filters)
    ? (obj.filters as ReportFilters["filters"])
    : [];
  const since = typeof obj.since === "string" ? obj.since : undefined;
  return { filters, since };
}

function asResult(raw: unknown): ReportResult | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!obj.generatedAt) return null;
  return {
    generatedAt: String(obj.generatedAt),
    type: (obj.type as ReportType) ?? "summary",
    metrics: Array.isArray(obj.metrics) ? (obj.metrics as ReportResult["metrics"]) : [],
    breakdown: Array.isArray(obj.breakdown)
      ? (obj.breakdown as ReportResult["breakdown"])
      : [],
    notes: Array.isArray(obj.notes) ? (obj.notes as string[]) : [],
  };
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

interface DefinitionRow {
  id: string;
  org_id: string;
  name: string;
  type: string;
  layout: unknown;
  filters: unknown;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: Date | string;
}

function mapDefinition(row: DefinitionRow): ReportDefinition {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    type: row.type as ReportType,
    layout: asLayout(row.layout),
    filters: asFilters(row.filters),
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
    createdAt: toIso(row.created_at),
  };
}

export interface DefinitionFilters {
  type?: string;
}

function buildDefinitionWhere(
  orgId: string,
  filters: DefinitionFilters
): { clause: string; params: unknown[] } {
  const params: unknown[] = [orgId];
  let clause = "d.org_id = $1";
  if (filters.type) {
    params.push(filters.type);
    clause += ` and d.type = $${params.length}`;
  }
  return { clause, params };
}

export async function listDefinitions(
  pool: Pool,
  orgId: string,
  filters: DefinitionFilters,
  limit: number,
  offset: number
): Promise<ReportDefinition[]> {
  const { clause, params } = buildDefinitionWhere(orgId, filters);
  params.push(limit, offset);
  const { rows } = await pool.query<DefinitionRow>(
    `select d.id, d.org_id, d.name, d.type, d.layout, d.filters,
            d.created_by, d.created_at, u.name as created_by_name
       from report_definitions d
       left join users u on u.id = d.created_by
      where ${clause}
      order by d.created_at desc
      limit $${params.length - 1} offset $${params.length}`,
    params
  );
  return rows.map(mapDefinition);
}

export async function countDefinitions(
  pool: Pool,
  orgId: string,
  filters: DefinitionFilters
): Promise<number> {
  const { clause, params } = buildDefinitionWhere(orgId, filters);
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count from report_definitions d where ${clause}`,
    params
  );
  return Number(rows[0]?.count ?? 0);
}

export async function getDefinition(
  pool: Pool,
  orgId: string,
  id: string
): Promise<ReportDefinition | null> {
  const { rows } = await pool.query<DefinitionRow>(
    `select d.id, d.org_id, d.name, d.type, d.layout, d.filters,
            d.created_by, d.created_at, u.name as created_by_name
       from report_definitions d
       left join users u on u.id = d.created_by
      where d.org_id = $1 and d.id = $2`,
    [orgId, id]
  );
  return rows[0] ? mapDefinition(rows[0]) : null;
}

export async function findDefinitionByName(
  pool: Pool,
  orgId: string,
  name: string
): Promise<ReportDefinition | null> {
  const { rows } = await pool.query<DefinitionRow>(
    `select id, org_id, name, type, layout, filters, created_by, created_at
       from report_definitions
      where org_id = $1 and lower(name) = lower($2)
      limit 1`,
    [orgId, name]
  );
  return rows[0] ? mapDefinition(rows[0]) : null;
}

export interface CreateDefinitionArgs {
  orgId: string;
  createdBy: string;
  name: string;
  type: ReportType;
  layout: ReportLayout;
  filters: ReportFilters;
}

export async function createDefinition(
  pool: Pool,
  args: CreateDefinitionArgs
): Promise<ReportDefinition> {
  const { rows } = await pool.query<DefinitionRow>(
    `insert into report_definitions
       (org_id, name, type, layout, filters, created_by)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
     returning id, org_id, name, type, layout, filters, created_by, created_at`,
    [
      args.orgId,
      args.name,
      args.type,
      JSON.stringify(args.layout),
      JSON.stringify(args.filters),
      args.createdBy,
    ]
  );
  return mapDefinition(rows[0]);
}

export interface UpdateDefinitionArgs {
  name?: string;
  type?: ReportType;
  layout?: ReportLayout;
  filters?: ReportFilters;
}

export async function updateDefinition(
  pool: Pool,
  orgId: string,
  id: string,
  args: UpdateDefinitionArgs
): Promise<ReportDefinition | null> {
  const sets: string[] = [];
  const params: unknown[] = [orgId, id];
  if (args.name !== undefined) {
    params.push(args.name);
    sets.push(`name = $${params.length}`);
  }
  if (args.type !== undefined) {
    params.push(args.type);
    sets.push(`type = $${params.length}`);
  }
  if (args.layout !== undefined) {
    params.push(JSON.stringify(args.layout));
    sets.push(`layout = $${params.length}::jsonb`);
  }
  if (args.filters !== undefined) {
    params.push(JSON.stringify(args.filters));
    sets.push(`filters = $${params.length}::jsonb`);
  }
  if (sets.length === 0) {
    return getDefinition(pool, orgId, id);
  }
  const { rows } = await pool.query<DefinitionRow>(
    `update report_definitions set ${sets.join(", ")}
      where org_id = $1 and id = $2
      returning id, org_id, name, type, layout, filters, created_by, created_at`,
    params
  );
  return rows[0] ? mapDefinition(rows[0]) : null;
}

export async function deleteDefinition(
  pool: Pool,
  orgId: string,
  id: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `delete from report_definitions where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return (rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

interface RunRow {
  id: string;
  org_id: string;
  definition_id: string;
  definition_name?: string | null;
  status: string;
  result: unknown;
  format: string;
  created_by: string | null;
  error: string | null;
  created_at: Date | string;
}

function mapRun(row: RunRow): ReportRun {
  return {
    id: row.id,
    orgId: row.org_id,
    definitionId: row.definition_id,
    definitionName: row.definition_name ?? null,
    status: row.status as RunStatus,
    result: asResult(row.result),
    format: row.format as ReportFormat,
    createdBy: row.created_by,
    error: row.error,
    createdAt: toIso(row.created_at),
  };
}

export interface RunFilters {
  definitionId?: string;
  status?: string;
}

function buildRunWhere(
  orgId: string,
  filters: RunFilters
): { clause: string; params: unknown[] } {
  const params: unknown[] = [orgId];
  let clause = "r.org_id = $1";
  if (filters.definitionId) {
    params.push(filters.definitionId);
    clause += ` and r.definition_id = $${params.length}`;
  }
  if (filters.status) {
    params.push(filters.status);
    clause += ` and r.status = $${params.length}`;
  }
  return { clause, params };
}

export async function listRuns(
  pool: Pool,
  orgId: string,
  filters: RunFilters,
  limit: number,
  offset: number
): Promise<ReportRun[]> {
  const { clause, params } = buildRunWhere(orgId, filters);
  params.push(limit, offset);
  const { rows } = await pool.query<RunRow>(
    `select r.id, r.org_id, r.definition_id, r.status, r.result, r.format,
            r.created_by, r.error, r.created_at, d.name as definition_name
       from report_runs r
       left join report_definitions d on d.id = r.definition_id
      where ${clause}
      order by r.created_at desc
      limit $${params.length - 1} offset $${params.length}`,
    params
  );
  return rows.map(mapRun);
}

export async function countRuns(
  pool: Pool,
  orgId: string,
  filters: RunFilters
): Promise<number> {
  const { clause, params } = buildRunWhere(orgId, filters);
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count from report_runs r where ${clause}`,
    params
  );
  return Number(rows[0]?.count ?? 0);
}

export async function getRun(
  pool: Pool,
  orgId: string,
  id: string
): Promise<ReportRun | null> {
  const { rows } = await pool.query<RunRow>(
    `select r.id, r.org_id, r.definition_id, r.status, r.result, r.format,
            r.created_by, r.error, r.created_at, d.name as definition_name
       from report_runs r
       left join report_definitions d on d.id = r.definition_id
      where r.org_id = $1 and r.id = $2`,
    [orgId, id]
  );
  return rows[0] ? mapRun(rows[0]) : null;
}

export interface CreateRunArgs {
  orgId: string;
  definitionId: string;
  createdBy: string;
  status: RunStatus;
  result: ReportResult | null;
  format: ReportFormat;
  error?: string | null;
}

export async function createRun(
  pool: Pool,
  args: CreateRunArgs
): Promise<ReportRun> {
  const { rows } = await pool.query<RunRow>(
    `insert into report_runs
       (org_id, definition_id, status, result, format, created_by, error)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7)
     returning id, org_id, definition_id, status, result, format,
               created_by, error, created_at`,
    [
      args.orgId,
      args.definitionId,
      args.status,
      JSON.stringify(args.result ?? {}),
      args.format,
      args.createdBy,
      args.error ?? null,
    ]
  );
  return mapRun(rows[0]);
}

// ---------------------------------------------------------------------------
// Scheduled reports
// ---------------------------------------------------------------------------

interface ScheduleRow {
  id: string;
  org_id: string;
  definition_id: string;
  definition_name?: string | null;
  cron: string;
  recipients: unknown;
  enabled: boolean;
  created_by: string | null;
  created_at: Date | string;
}

function asRecipients(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((r): r is string => typeof r === "string") : [];
}

function mapSchedule(row: ScheduleRow): ScheduledReport {
  return {
    id: row.id,
    orgId: row.org_id,
    definitionId: row.definition_id,
    definitionName: row.definition_name ?? null,
    cron: row.cron,
    recipients: asRecipients(row.recipients),
    enabled: row.enabled,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
  };
}

export async function listSchedules(
  pool: Pool,
  orgId: string,
  limit: number,
  offset: number
): Promise<ScheduledReport[]> {
  const { rows } = await pool.query<ScheduleRow>(
    `select s.id, s.org_id, s.definition_id, s.cron, s.recipients, s.enabled,
            s.created_by, s.created_at, d.name as definition_name
       from scheduled_reports s
       left join report_definitions d on d.id = s.definition_id
      where s.org_id = $1
      order by s.created_at desc
      limit $2 offset $3`,
    [orgId, limit, offset]
  );
  return rows.map(mapSchedule);
}

export async function countSchedules(pool: Pool, orgId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count from scheduled_reports where org_id = $1`,
    [orgId]
  );
  return Number(rows[0]?.count ?? 0);
}

export async function getSchedule(
  pool: Pool,
  orgId: string,
  id: string
): Promise<ScheduledReport | null> {
  const { rows } = await pool.query<ScheduleRow>(
    `select s.id, s.org_id, s.definition_id, s.cron, s.recipients, s.enabled,
            s.created_by, s.created_at, d.name as definition_name
       from scheduled_reports s
       left join report_definitions d on d.id = s.definition_id
      where s.org_id = $1 and s.id = $2`,
    [orgId, id]
  );
  return rows[0] ? mapSchedule(rows[0]) : null;
}

export async function findScheduleByDefinition(
  pool: Pool,
  orgId: string,
  definitionId: string
): Promise<ScheduledReport | null> {
  const { rows } = await pool.query<ScheduleRow>(
    `select id, org_id, definition_id, cron, recipients, enabled,
            created_by, created_at
       from scheduled_reports
      where org_id = $1 and definition_id = $2
      limit 1`,
    [orgId, definitionId]
  );
  return rows[0] ? mapSchedule(rows[0]) : null;
}

export interface CreateScheduleArgs {
  orgId: string;
  definitionId: string;
  createdBy: string;
  cron: string;
  recipients: string[];
  enabled: boolean;
}

export async function createSchedule(
  pool: Pool,
  args: CreateScheduleArgs
): Promise<ScheduledReport> {
  const { rows } = await pool.query<ScheduleRow>(
    `insert into scheduled_reports
       (org_id, definition_id, cron, recipients, enabled, created_by)
     values ($1, $2, $3, $4::jsonb, $5, $6)
     returning id, org_id, definition_id, cron, recipients, enabled,
               created_by, created_at`,
    [
      args.orgId,
      args.definitionId,
      args.cron,
      JSON.stringify(args.recipients),
      args.enabled,
      args.createdBy,
    ]
  );
  return mapSchedule(rows[0]);
}

export interface UpdateScheduleArgs {
  cron?: string;
  recipients?: string[];
  enabled?: boolean;
}

export async function updateSchedule(
  pool: Pool,
  orgId: string,
  id: string,
  args: UpdateScheduleArgs
): Promise<ScheduledReport | null> {
  const sets: string[] = [];
  const params: unknown[] = [orgId, id];
  if (args.cron !== undefined) {
    params.push(args.cron);
    sets.push(`cron = $${params.length}`);
  }
  if (args.recipients !== undefined) {
    params.push(JSON.stringify(args.recipients));
    sets.push(`recipients = $${params.length}::jsonb`);
  }
  if (args.enabled !== undefined) {
    params.push(args.enabled);
    sets.push(`enabled = $${params.length}`);
  }
  if (sets.length === 0) {
    return getSchedule(pool, orgId, id);
  }
  const { rows } = await pool.query<ScheduleRow>(
    `update scheduled_reports set ${sets.join(", ")}
      where org_id = $1 and id = $2
      returning id, org_id, definition_id, cron, recipients, enabled,
                created_by, created_at`,
    params
  );
  return rows[0] ? mapSchedule(rows[0]) : null;
}

export async function deleteSchedule(
  pool: Pool,
  orgId: string,
  id: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `delete from scheduled_reports where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return (rowCount ?? 0) > 0;
}
