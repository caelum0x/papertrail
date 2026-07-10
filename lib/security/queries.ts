import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import type {
  SecurityEventKind,
  SecuritySeverity,
} from "@/lib/security/threatDetection";

// Read layer for the security_events feed. Every query is org-scoped: org_id is
// always the first bound parameter and comes from the resolved Ctx.org, never
// from raw client input. All SQL is parameterized. Returned rows carry only
// ids/counts/thresholds in `detail` — the detectors never write raw text there.

export interface SecurityEventItem {
  id: string;
  kind: SecurityEventKind;
  severity: SecuritySeverity;
  detail: Record<string, unknown>;
  sourceIp: string | null;
  detectedAt: string;
}

export interface ListSecurityEventsArgs {
  orgId: string;
  severity: SecuritySeverity | null;
  limit: number;
  offset: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
}

interface SecurityEventRow {
  id: string;
  kind: string;
  severity: string;
  detail: Record<string, unknown> | null;
  source_ip: string | null;
  detected_at: Date | string;
}

interface CountRow {
  c: string | number;
}

function toIso(v: Date | string): string {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

function mapRow(row: SecurityEventRow): SecurityEventItem {
  return {
    id: row.id,
    kind: row.kind as SecurityEventKind,
    severity: row.severity as SecuritySeverity,
    detail: row.detail ?? {},
    sourceIp: row.source_ip,
    detectedAt: toIso(row.detected_at),
  };
}

// Builds the org-scoped WHERE clause + params. org_id is always $1; an optional
// severity filter appends one parameterized condition.
function buildFilters(args: ListSecurityEventsArgs): {
  where: string;
  params: unknown[];
} {
  const params: unknown[] = [args.orgId];
  const clauses = ["org_id = $1"];
  if (args.severity) {
    params.push(args.severity);
    clauses.push(`severity = $${params.length}`);
  }
  return { where: clauses.join(" and "), params };
}

export async function listSecurityEvents(
  args: ListSecurityEventsArgs,
  pool: Pool = getPool()
): Promise<Paginated<SecurityEventItem>> {
  const { where, params } = buildFilters(args);

  const countRes = await pool.query<CountRow>(
    `select count(*)::int as c from security_events where ${where}`,
    params
  );
  const total = Number(countRes.rows[0]?.c ?? 0);

  const listParams = [...params, args.limit, args.offset];
  const limitPos = listParams.length - 1;
  const offsetPos = listParams.length;

  const res = await pool.query<SecurityEventRow>(
    `select id, kind, severity, detail, source_ip, detected_at
       from security_events
      where ${where}
      order by detected_at desc
      limit $${limitPos} offset $${offsetPos}`,
    listParams
  );

  return { items: res.rows.map(mapRow), total };
}

interface SeverityCountRow {
  severity: string;
  c: string | number;
}

// Per-severity counts for the org's whole security_events history — powers the
// dashboard's severity summary cards. Org-scoped and parameterized.
export async function getSeverityCounts(
  orgId: string,
  pool: Pool = getPool()
): Promise<Record<SecuritySeverity, number>> {
  const { rows } = await pool.query<SeverityCountRow>(
    `select severity, count(*)::int as c
       from security_events
      where org_id = $1
      group by severity`,
    [orgId]
  );
  const counts: Record<SecuritySeverity, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  for (const row of rows) {
    if (row.severity in counts) {
      counts[row.severity as SecuritySeverity] = Number(row.c);
    }
  }
  return counts;
}
