import type { Pool } from "pg";
import type {
  ReportDefinition,
  ReportResult,
  ReportBreakdownRow,
  ReportMetric,
} from "@/lib/reporting/types";

// Report composer. Materializes a definition into a concrete ReportResult by
// aggregating ONLY org-scoped data. Every query filters by org_id so a run can
// never surface another tenant's rows. Composition is read-only and side-effect
// free — the API route persists the returned result as a report_run.

function parseSince(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Counts rows in an org-scoped table, optionally bounded by a `since` cutoff.
async function totalFor(
  pool: Pool,
  table: "claims" | "documents" | "reviews",
  orgId: string,
  since: Date | null
): Promise<number> {
  const params: unknown[] = [orgId];
  let sql = `select count(*)::text as count from ${table} where org_id = $1`;
  if (since) {
    params.push(since.toISOString());
    sql += ` and created_at >= $${params.length}`;
  }
  const { rows } = await pool.query<{ count: string }>(sql, params);
  return Number(rows[0]?.count ?? 0);
}

// Groups an org-scoped table by its status column into breakdown rows.
async function statusBreakdown(
  pool: Pool,
  table: "claims" | "reviews",
  orgId: string,
  since: Date | null
): Promise<ReportBreakdownRow[]> {
  const params: unknown[] = [orgId];
  let sql = `select status, count(*)::text as count from ${table} where org_id = $1`;
  if (since) {
    params.push(since.toISOString());
    sql += ` and created_at >= $${params.length}`;
  }
  sql += ` group by status order by count(*) desc`;
  const { rows } = await pool.query<{ status: string; count: string }>(sql, params);
  return rows.map((r) => ({ label: r.status, count: Number(r.count) }));
}

// Composes a definition into a result. `type` selects which org-scoped tables
// are aggregated. Unknown types fall back to the summary composition rather than
// fabricating data.
export async function composeReport(
  pool: Pool,
  orgId: string,
  definition: ReportDefinition
): Promise<ReportResult> {
  const since = parseSince(definition.filters.since);
  const notes: string[] = [];
  if (since) {
    notes.push(`Bounded to records created on or after ${since.toISOString()}.`);
  }
  if (definition.filters.filters.length > 0) {
    notes.push(
      `${definition.filters.filters.length} custom filter(s) recorded on the definition.`
    );
  }

  let metrics: ReportMetric[] = [];
  let breakdown: ReportBreakdownRow[] = [];

  switch (definition.type) {
    case "claims": {
      const total = await totalFor(pool, "claims", orgId, since);
      breakdown = await statusBreakdown(pool, "claims", orgId, since);
      metrics = [{ label: "Total claims", value: total }];
      break;
    }
    case "reviews": {
      const total = await totalFor(pool, "reviews", orgId, since);
      breakdown = await statusBreakdown(pool, "reviews", orgId, since);
      metrics = [{ label: "Total reviews", value: total }];
      break;
    }
    case "documents": {
      const total = await totalFor(pool, "documents", orgId, since);
      metrics = [{ label: "Total documents", value: total }];
      break;
    }
    case "summary":
    default: {
      const [claims, documents, reviews] = await Promise.all([
        totalFor(pool, "claims", orgId, since),
        totalFor(pool, "documents", orgId, since),
        totalFor(pool, "reviews", orgId, since),
      ]);
      metrics = [
        { label: "Claims", value: claims },
        { label: "Documents", value: documents },
        { label: "Reviews", value: reviews },
      ];
      breakdown = await statusBreakdown(pool, "claims", orgId, since);
      break;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    type: definition.type,
    metrics,
    breakdown,
    notes,
  };
}
