import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import type {
  ApiRequestLogItem,
  KeyUsage,
  RateLimitEventItem,
  RouteUsage,
  TimeseriesPoint,
  UsageSummary,
  UsageTimeseries,
} from "./types";
import type {
  Bucket,
  RateLimitQuery,
  RequestLogQuery,
} from "./schemas";

// Read layer for the API-usage analytics module. Every query is org-scoped: the
// org id is always the first bound parameter and never comes from client input
// directly (it comes from the resolved Ctx.org). All SQL is parameterized. This
// module lives beside the routes' lib home so the module owns its own data access
// without reaching into sibling lib/ directories.

const TOP_N = 8;

function toRate(errors: number, total: number): number {
  return total > 0 ? errors / total : 0;
}

function toNullableInt(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toIso(v: Date | string | null): string | null {
  if (v === null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------------------------------------------------------------------
// Summary: totals + by-route + by-key + error rate
// ---------------------------------------------------------------------------

interface TotalsRow {
  requests: number;
  errors: number;
  avg_ms: string | null;
  p95_ms: string | null;
}
interface RouteRow {
  route: string;
  requests: number;
  errors: number;
  avg_ms: string | null;
  p95_ms: string | null;
}
interface KeyRow {
  api_key_id: string | null;
  key_name: string | null;
  requests: number;
  errors: number;
  last_used_at: Date | null;
}
interface CountRow {
  c: number;
}

export async function getUsageSummary(
  orgId: string,
  rangeDays: number,
  pool: Pool = getPool()
): Promise<UsageSummary> {
  const [totalsRes, routesRes, keysRes, rateLimitRes, activeKeysRes] =
    await Promise.all([
      pool.query<TotalsRow>(
        `select
            count(*)::int as requests,
            count(*) filter (where status_code >= 400)::int as errors,
            avg(duration_ms) as avg_ms,
            percentile_cont(0.95) within group (order by duration_ms) as p95_ms
           from api_requests
          where org_id = $1
            and created_at >= now() - ($2::int || ' days')::interval`,
        [orgId, rangeDays]
      ),
      pool.query<RouteRow>(
        `select
            route,
            count(*)::int as requests,
            count(*) filter (where status_code >= 400)::int as errors,
            avg(duration_ms) as avg_ms,
            percentile_cont(0.95) within group (order by duration_ms) as p95_ms
           from api_requests
          where org_id = $1
            and created_at >= now() - ($2::int || ' days')::interval
          group by route
          order by requests desc
          limit $3`,
        [orgId, rangeDays, TOP_N]
      ),
      pool.query<KeyRow>(
        `select
            r.api_key_id,
            k.name as key_name,
            count(*)::int as requests,
            count(*) filter (where r.status_code >= 400)::int as errors,
            k.last_used_at
           from api_requests r
           left join api_keys k on k.id = r.api_key_id
          where r.org_id = $1
            and r.created_at >= now() - ($2::int || ' days')::interval
          group by r.api_key_id, k.name, k.last_used_at
          order by requests desc
          limit $3`,
        [orgId, rangeDays, TOP_N]
      ),
      pool.query<CountRow>(
        `select count(*)::int as c
           from rate_limit_events
          where org_id = $1
            and created_at >= now() - ($2::int || ' days')::interval`,
        [orgId, rangeDays]
      ),
      pool.query<CountRow>(
        `select count(distinct r.api_key_id)::int as c
           from api_requests r
          where r.org_id = $1
            and r.api_key_id is not null
            and r.created_at >= now() - ($2::int || ' days')::interval`,
        [orgId, rangeDays]
      ),
    ]);

  const totals = totalsRes.rows[0];
  const totalRequests = totals?.requests ?? 0;
  const totalErrors = totals?.errors ?? 0;

  const topRoutes: RouteUsage[] = routesRes.rows.map((r) => ({
    route: r.route,
    requests: r.requests,
    errors: r.errors,
    errorRate: toRate(r.errors, r.requests),
    avgDurationMs: toNullableInt(r.avg_ms),
    p95DurationMs: toNullableInt(r.p95_ms),
  }));

  const topKeys: KeyUsage[] = keysRes.rows.map((r) => ({
    apiKeyId: r.api_key_id,
    keyName: r.key_name,
    requests: r.requests,
    errors: r.errors,
    errorRate: toRate(r.errors, r.requests),
    lastUsedAt: toIso(r.last_used_at),
  }));

  return {
    rangeDays,
    totalRequests,
    totalErrors,
    errorRate: toRate(totalErrors, totalRequests),
    avgDurationMs: toNullableInt(totals?.avg_ms ?? null),
    p95DurationMs: toNullableInt(totals?.p95_ms ?? null),
    rateLimitedCount: rateLimitRes.rows[0]?.c ?? 0,
    activeKeys: activeKeysRes.rows[0]?.c ?? 0,
    topRoutes,
    topKeys,
  };
}

// ---------------------------------------------------------------------------
// Timeseries
// ---------------------------------------------------------------------------

interface SeriesRow {
  bucket: Date;
  requests: number;
  errors: number;
  avg_ms: string | null;
}

// Whitelist the bucket -> date_trunc unit mapping so the interval string is never
// built from raw client input (it comes only from the validated enum).
const BUCKET_UNIT: Record<Bucket, string> = {
  hour: "hour",
  day: "day",
  week: "week",
};

export async function getUsageTimeseries(
  orgId: string,
  rangeDays: number,
  bucket: Bucket,
  pool: Pool = getPool()
): Promise<UsageTimeseries> {
  const unit = BUCKET_UNIT[bucket];
  const res = await pool.query<SeriesRow>(
    `select
        date_trunc($3, created_at) as bucket,
        count(*)::int as requests,
        count(*) filter (where status_code >= 400)::int as errors,
        avg(duration_ms) as avg_ms
       from api_requests
      where org_id = $1
        and created_at >= now() - ($2::int || ' days')::interval
      group by 1
      order by 1 asc`,
    [orgId, rangeDays, unit]
  );

  const points: TimeseriesPoint[] = res.rows.map((r) => ({
    bucket: toIso(r.bucket) ?? String(r.bucket),
    requests: r.requests,
    errors: r.errors,
    avgDurationMs: toNullableInt(r.avg_ms),
  }));

  return {
    rangeDays,
    bucket,
    totalRequests: points.reduce((sum, p) => sum + p.requests, 0),
    points,
  };
}

// ---------------------------------------------------------------------------
// Paginated request log
// ---------------------------------------------------------------------------

interface LogRow {
  id: string;
  route: string;
  method: string;
  status_code: number;
  duration_ms: number;
  api_key_id: string | null;
  key_name: string | null;
  created_at: Date;
}

export interface ListRequestLogArgs extends RequestLogQuery {
  orgId: string;
  limit: number;
  offset: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
}

// Builds the shared WHERE clause + bound params for the request log. org_id is
// always param $1; optional filters append parameterized conditions.
function buildLogFilters(args: ListRequestLogArgs): {
  where: string;
  params: unknown[];
} {
  const params: unknown[] = [args.orgId];
  const clauses = ["r.org_id = $1"];

  if (args.route) {
    params.push(args.route);
    clauses.push(`r.route = $${params.length}`);
  }
  if (args.method) {
    params.push(args.method);
    clauses.push(`r.method = $${params.length}`);
  }
  if (args.apiKeyId) {
    params.push(args.apiKeyId);
    clauses.push(`r.api_key_id = $${params.length}`);
  }
  if (args.status === "errors") {
    clauses.push("r.status_code >= 400");
  } else if (args.status === "success") {
    clauses.push("r.status_code < 400");
  }

  return { where: clauses.join(" and "), params };
}

export async function listRequestLog(
  args: ListRequestLogArgs,
  pool: Pool = getPool()
): Promise<Paginated<ApiRequestLogItem>> {
  const { where, params } = buildLogFilters(args);

  const countRes = await pool.query<CountRow>(
    `select count(*)::int as c from api_requests r where ${where}`,
    params
  );
  const total = countRes.rows[0]?.c ?? 0;

  const listParams = [...params, args.limit, args.offset];
  const limitPos = listParams.length - 1;
  const offsetPos = listParams.length;

  const res = await pool.query<LogRow>(
    `select
        r.id, r.route, r.method, r.status_code, r.duration_ms,
        r.api_key_id, k.name as key_name, r.created_at
       from api_requests r
       left join api_keys k on k.id = r.api_key_id
      where ${where}
      order by r.created_at desc
      limit $${limitPos} offset $${offsetPos}`,
    listParams
  );

  const items: ApiRequestLogItem[] = res.rows.map((r) => ({
    id: r.id,
    route: r.route,
    method: r.method,
    statusCode: r.status_code,
    durationMs: r.duration_ms,
    apiKeyId: r.api_key_id,
    keyName: r.key_name,
    createdAt: toIso(r.created_at) ?? String(r.created_at),
  }));

  return { items, total };
}

// ---------------------------------------------------------------------------
// Paginated rate-limit events
// ---------------------------------------------------------------------------

interface RateLimitRow {
  id: string;
  route: string;
  api_key_id: string | null;
  key_name: string | null;
  created_at: Date;
}

export interface ListRateLimitArgs extends RateLimitQuery {
  orgId: string;
  limit: number;
  offset: number;
}

function buildRateLimitFilters(args: ListRateLimitArgs): {
  where: string;
  params: unknown[];
} {
  const params: unknown[] = [args.orgId];
  const clauses = ["e.org_id = $1"];

  if (args.route) {
    params.push(args.route);
    clauses.push(`e.route = $${params.length}`);
  }
  if (args.apiKeyId) {
    params.push(args.apiKeyId);
    clauses.push(`e.api_key_id = $${params.length}`);
  }

  return { where: clauses.join(" and "), params };
}

export async function listRateLimitEvents(
  args: ListRateLimitArgs,
  pool: Pool = getPool()
): Promise<Paginated<RateLimitEventItem>> {
  const { where, params } = buildRateLimitFilters(args);

  const countRes = await pool.query<CountRow>(
    `select count(*)::int as c from rate_limit_events e where ${where}`,
    params
  );
  const total = countRes.rows[0]?.c ?? 0;

  const listParams = [...params, args.limit, args.offset];
  const limitPos = listParams.length - 1;
  const offsetPos = listParams.length;

  const res = await pool.query<RateLimitRow>(
    `select
        e.id, e.route, e.api_key_id, k.name as key_name, e.created_at
       from rate_limit_events e
       left join api_keys k on k.id = e.api_key_id
      where ${where}
      order by e.created_at desc
      limit $${limitPos} offset $${offsetPos}`,
    listParams
  );

  const items: RateLimitEventItem[] = res.rows.map((r) => ({
    id: r.id,
    route: r.route,
    apiKeyId: r.api_key_id,
    keyName: r.key_name,
    createdAt: toIso(r.created_at) ?? String(r.created_at),
  }));

  return { items, total };
}
