import type { Pool } from "pg";

// Org-scoped analytics over persisted evidence reports. Pure data access — plain
// aggregate SQL (count / group by), no mutation, no report recomputation. EVERY
// query filters on org_id as its FIRST predicate so a caller can only ever see
// their own tenant's reports (same tenancy guarantee as the repository).
//
// Reads the `evidence_reports` table populated by lib/evidenceReports/repository.ts
// (denormalized `claim`, `verdict`, `certainty`, `created_at` columns), so none of
// these scans need to crack open the jsonb payload.

// The four GRADE certainty buckets (see lib/grade.ts `Certainty`). Kept fixed so
// the summary always renders every bucket, even at zero.
const CERTAINTY_KEYS = ["high", "moderate", "low", "very_low"] as const;
type CertaintyKey = (typeof CERTAINTY_KEYS)[number];

export interface EvidenceReportAnalytics {
  total: number;
  byCertainty: Record<CertaintyKey, number>;
  byVerdict: Record<string, number>;
  recent: {
    id: string;
    claim: string;
    certainty: string | null;
    verdict: string | null;
    createdAt: string;
  }[];
  perMonth: { month: string; count: number }[];
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function emptyCertainty(): Record<CertaintyKey, number> {
  return { high: 0, moderate: 0, low: 0, very_low: 0 };
}

interface CountRow {
  total: number;
}
interface CertaintyRow {
  certainty: string | null;
  count: number;
}
interface VerdictRow {
  verdict: string | null;
  count: number;
}
interface RecentRow {
  id: string;
  claim: string;
  certainty: string | null;
  verdict: string | null;
  created_at: Date | string;
}
interface MonthRow {
  month: Date | string;
  count: number;
}

// At-a-glance analytics for one org's saved evidence reports. Runs five small
// org-scoped aggregates in parallel; each is independently org_id-filtered.
export async function evidenceReportAnalytics(
  pool: Pool,
  params: { orgId: string }
): Promise<EvidenceReportAnalytics> {
  const { orgId } = params;

  const [totalRes, certaintyRes, verdictRes, recentRes, monthRes] = await Promise.all([
    pool.query<CountRow>(
      `select count(*)::int as total
         from evidence_reports
        where org_id = $1`,
      [orgId]
    ),
    pool.query<CertaintyRow>(
      `select certainty, count(*)::int as count
         from evidence_reports
        where org_id = $1
        group by certainty`,
      [orgId]
    ),
    pool.query<VerdictRow>(
      `select verdict, count(*)::int as count
         from evidence_reports
        where org_id = $1
        group by verdict
        order by count desc`,
      [orgId]
    ),
    pool.query<RecentRow>(
      `select id, claim, certainty, verdict, created_at
         from evidence_reports
        where org_id = $1
        order by created_at desc
        limit 10`,
      [orgId]
    ),
    pool.query<MonthRow>(
      `select date_trunc('month', created_at) as month, count(*)::int as count
         from evidence_reports
        where org_id = $1
        group by date_trunc('month', created_at)
        order by month asc`,
      [orgId]
    ),
  ]);

  // Fold the certainty rows into the fixed four-bucket shape; unknown/null
  // certainties fall outside the GRADE scale and are simply not counted.
  const byCertainty = emptyCertainty();
  for (const row of certaintyRes.rows) {
    if (row.certainty && (CERTAINTY_KEYS as readonly string[]).includes(row.certainty)) {
      byCertainty[row.certainty as CertaintyKey] = row.count;
    }
  }

  const byVerdict: Record<string, number> = {};
  for (const row of verdictRes.rows) {
    byVerdict[row.verdict ?? "unknown"] = row.count;
  }

  const recent = recentRes.rows.map((row) => ({
    id: row.id,
    claim: row.claim,
    certainty: row.certainty,
    verdict: row.verdict,
    createdAt: toIso(row.created_at),
  }));

  // Normalize each month bucket to YYYY-MM for a stable, tz-independent key.
  const perMonth = monthRes.rows.map((row) => ({
    month: toIso(row.month).slice(0, 7),
    count: row.count,
  }));

  return {
    total: totalRes.rows[0]?.total ?? 0,
    byCertainty,
    byVerdict,
    recent,
    perMonth,
  };
}
