import type { Pool } from "pg";
import type {
  ErrorEvent,
  ErrorLevel,
  LogEntry,
  MetricSeries,
  MetricSeriesPoint,
} from "@/lib/observability/types";
import type {
  ErrorsQuery,
  IngestErrorInput,
  LogsQuery,
  MetricsQuery,
} from "@/lib/observability/schemas";
import { WINDOW_HOURS } from "@/lib/observability/schemas";

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asContext(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

interface ErrorRow {
  id: string;
  level: string;
  message: string;
  context: unknown;
  created_at: Date | string;
}

function mapError(row: ErrorRow): ErrorEvent {
  return {
    id: row.id,
    level: row.level as ErrorLevel,
    message: row.message,
    context: asContext(row.context),
    createdAt: toIso(row.created_at),
  };
}

// Insert one error event and return it.
export async function ingestError(
  pool: Pool,
  orgId: string,
  input: IngestErrorInput
): Promise<ErrorEvent> {
  const { rows } = await pool.query<ErrorRow>(
    `insert into error_events (org_id, level, message, context)
     values ($1, $2, $3, $4::jsonb)
     returning id, level, message, context, created_at`,
    [orgId, input.level, input.message, JSON.stringify(input.context ?? {})]
  );
  return mapError(rows[0]);
}

// List recent error events for an org, newest first, with optional filters.
export async function listErrors(
  pool: Pool,
  orgId: string,
  query: ErrorsQuery,
  limit: number,
  offset: number
): Promise<{ items: ErrorEvent[]; total: number }> {
  const params: unknown[] = [orgId];
  const where: string[] = ["org_id = $1"];
  if (query.level) {
    params.push(query.level);
    where.push(`level = $${params.length}`);
  }
  if (query.q) {
    params.push(`%${query.q}%`);
    where.push(`message ilike $${params.length}`);
  }
  const whereSql = where.join(" and ");

  const totalRes = await pool.query<{ count: string }>(
    `select count(*)::int as count from error_events where ${whereSql}`,
    params
  );
  const total = Number(totalRes.rows[0]?.count ?? 0);

  const pageParams = [...params, limit, offset];
  const { rows } = await pool.query<ErrorRow>(
    `select id, level, message, context, created_at
       from error_events
      where ${whereSql}
      order by created_at desc
      limit $${pageParams.length - 1} offset $${pageParams.length}`,
    pageParams
  );
  return { items: rows.map(mapError), total };
}

// Fetch a single error event by id (org-scoped). Null if not found.
export async function getError(
  pool: Pool,
  orgId: string,
  id: string
): Promise<ErrorEvent | null> {
  const { rows } = await pool.query<ErrorRow>(
    `select id, level, message, context, created_at
       from error_events
      where org_id = $1 and id = $2
      limit 1`,
    [orgId, id]
  );
  return rows.length > 0 ? mapError(rows[0]) : null;
}

// Count error events grouped by level within a window (for the overview panel).
export async function countErrorsByLevel(
  pool: Pool,
  orgId: string,
  windowHours: number
): Promise<Record<string, number>> {
  const { rows } = await pool.query<{ level: string; count: string }>(
    `select level, count(*)::int as count
       from error_events
      where org_id = $1
        and created_at >= now() - ($2 || ' hours')::interval
      group by level`,
    [orgId, String(windowHours)]
  );
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[r.level] = Number(r.count);
  }
  return out;
}

// Distinct metric names seen for an org (drives the metrics page selector).
export async function listMetricNames(pool: Pool, orgId: string): Promise<string[]> {
  const { rows } = await pool.query<{ metric: string }>(
    `select distinct metric from system_metrics
      where org_id = $1
      order by metric asc`,
    [orgId]
  );
  return rows.map((r) => r.metric);
}

// Build a bucketed time series for one metric over a window. Buckets are evenly
// spaced; empty buckets are omitted (the chart interpolates visually).
export async function metricSeries(
  pool: Pool,
  orgId: string,
  metric: string,
  query: MetricsQuery
): Promise<MetricSeries> {
  const windowHours = WINDOW_HOURS[query.window];
  const bucketSeconds = Math.max(
    1,
    Math.floor((windowHours * 3600) / query.buckets)
  );

  const { rows } = await pool.query<{
    bucket: Date | string;
    avg: string;
    min: string;
    max: string;
    count: string;
  }>(
    `select
        to_timestamp(floor(extract(epoch from recorded_at) / $3) * $3) as bucket,
        avg(value) as avg,
        min(value) as min,
        max(value) as max,
        count(*)::int as count
       from system_metrics
      where org_id = $1
        and metric = $2
        and recorded_at >= now() - ($4 || ' hours')::interval
      group by 1
      order by 1 asc`,
    [orgId, metric, bucketSeconds, String(windowHours)]
  );

  const points: MetricSeriesPoint[] = rows.map((r) => ({
    bucket: toIso(r.bucket),
    avg: Number(r.avg),
    min: Number(r.min),
    max: Number(r.max),
    count: Number(r.count),
  }));

  const totalRes = await pool.query<{ count: string; latest: string | null }>(
    `select
        count(*)::int as count,
        (select value from system_metrics
          where org_id = $1 and metric = $2
          order by recorded_at desc limit 1) as latest
       from system_metrics
      where org_id = $1 and metric = $2
        and recorded_at >= now() - ($3 || ' hours')::interval`,
    [orgId, metric, String(windowHours)]
  );
  const total = Number(totalRes.rows[0]?.count ?? 0);
  const latestRaw = totalRes.rows[0]?.latest;
  const latest = latestRaw === null || latestRaw === undefined ? null : Number(latestRaw);

  return { metric, points, latest, total };
}

interface LogErrorRow {
  id: string;
  level: string;
  message: string;
  context: unknown;
  created_at: Date | string;
}

interface LogAuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: unknown;
  actor: string | null;
  created_at: Date | string;
}

// Unified recent log feed: merges error_events and audit_log into a single
// newest-first stream. `source` narrows to one stream; `level` filters errors;
// `q` matches message/action text.
export async function listLogs(
  pool: Pool,
  orgId: string,
  query: LogsQuery,
  limit: number,
  offset: number
): Promise<{ items: LogEntry[]; total: number }> {
  const entries: LogEntry[] = [];

  const wantErrors = query.source === "all" || query.source === "error";
  const wantAudit = query.source === "all" || query.source === "audit";

  // Over-fetch each stream so the merged+paginated result is correct without a
  // full UNION over two dissimilar tables. The cap keeps memory bounded.
  const fetchCap = Math.min(offset + limit, 500);

  if (wantErrors) {
    const params: unknown[] = [orgId];
    const where: string[] = ["org_id = $1"];
    if (query.level) {
      params.push(query.level);
      where.push(`level = $${params.length}`);
    }
    if (query.q) {
      params.push(`%${query.q}%`);
      where.push(`message ilike $${params.length}`);
    }
    params.push(fetchCap);
    const { rows } = await pool.query<LogErrorRow>(
      `select id, level, message, context, created_at
         from error_events
        where ${where.join(" and ")}
        order by created_at desc
        limit $${params.length}`,
      params
    );
    for (const r of rows) {
      entries.push({
        id: `error:${r.id}`,
        source: "error",
        level: r.level as ErrorLevel,
        message: r.message,
        actor: null,
        context: asContext(r.context),
        createdAt: toIso(r.created_at),
      });
    }
  }

  // Audit rows are excluded when a level filter is set (audit has no level).
  if (wantAudit && !query.level) {
    const params: unknown[] = [orgId];
    const where: string[] = ["a.org_id = $1"];
    if (query.q) {
      params.push(`%${query.q}%`);
      where.push(`a.action ilike $${params.length}`);
    }
    params.push(fetchCap);
    const { rows } = await pool.query<LogAuditRow>(
      `select a.id, a.action, a.entity_type, a.entity_id, a.metadata,
              u.email as actor, a.created_at
         from audit_log a
         left join users u on u.id = a.user_id
        where ${where.join(" and ")}
        order by a.created_at desc
        limit $${params.length}`,
      params
    );
    for (const r of rows) {
      entries.push({
        id: `audit:${r.id}`,
        source: "audit",
        level: null,
        message: r.action,
        actor: r.actor,
        context: {
          entityType: r.entity_type,
          entityId: r.entity_id,
          ...asContext(r.metadata),
        },
        createdAt: toIso(r.created_at),
      });
    }
  }

  entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const total = entries.length;
  const items = entries.slice(offset, offset + limit);
  return { items, total };
}
