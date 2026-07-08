import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import type { DashboardWidget, MetricKey } from "./repository";

// Widget data resolver. Given the widgets on a dashboard, compute each widget's
// value(s) strictly org-scoped. All SQL is parameterized and every query filters
// on the org (directly, or via a join through claims for the org-less legacy
// `verifications` table). A widget whose config is unresolvable returns a null
// value with an `error` string rather than throwing — one bad widget must not
// blank the whole dashboard.

const DISTORTION_TYPES = [
  "magnitude_overstated",
  "population_overgeneralized",
  "caveat_dropped",
  "no_support_found",
] as const;

export interface MetricValue {
  kind: "metric";
  value: number | null;
  format: "count" | "percent" | "score";
  label: string;
}

export interface ListItem {
  id: string;
  primary: string;
  secondary: string | null;
}

export interface ListValue {
  kind: "list";
  items: ListItem[];
  label: string;
}

export interface ChartPoint {
  label: string;
  value: number;
}

export interface ChartValue {
  kind: "chart";
  series: ChartPoint[];
  label: string;
}

export type ResolvedData = MetricValue | ListValue | ChartValue | null;

export interface ResolvedWidget {
  widgetId: string;
  kind: DashboardWidget["kind"];
  title: string;
  data: ResolvedData;
  error: string | null;
}

const METRIC_LABELS: Record<MetricKey, string> = {
  claims_verified: "Claims verified",
  total_verifications: "Total verifications",
  documents_processed: "Documents processed",
  avg_trust_score: "Average trust score",
  distortion_rate: "Distortion rate",
};

function clampRange(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return 30;
  return Math.min(Math.max(Math.floor(raw), 1), 365);
}

function clampLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return 5;
  return Math.min(Math.max(Math.floor(raw), 1), 50);
}

async function resolveMetric(
  orgId: string,
  metric: MetricKey,
  pool: Pool
): Promise<MetricValue> {
  const label = METRIC_LABELS[metric];
  switch (metric) {
    case "claims_verified": {
      const { rows } = await pool.query<{ c: number }>(
        `select count(distinct c.id)::int as c
           from claims c
           join verifications v on v.claim_id = c.id
          where c.org_id = $1`,
        [orgId]
      );
      return { kind: "metric", value: rows[0]?.c ?? 0, format: "count", label };
    }
    case "total_verifications": {
      const { rows } = await pool.query<{ c: number }>(
        `select count(v.*)::int as c
           from verifications v
           join claims c on c.id = v.claim_id
          where c.org_id = $1`,
        [orgId]
      );
      return { kind: "metric", value: rows[0]?.c ?? 0, format: "count", label };
    }
    case "documents_processed": {
      const { rows } = await pool.query<{ c: number }>(
        `select count(*)::int as c from documents where org_id = $1`,
        [orgId]
      );
      return { kind: "metric", value: rows[0]?.c ?? 0, format: "count", label };
    }
    case "avg_trust_score": {
      const { rows } = await pool.query<{ avg: string | null }>(
        `select avg(v.trust_score) as avg
           from verifications v
           join claims c on c.id = v.claim_id
          where c.org_id = $1`,
        [orgId]
      );
      const raw = rows[0]?.avg;
      return {
        kind: "metric",
        value: raw === null || raw === undefined ? null : Math.round(Number(raw)),
        format: "score",
        label,
      };
    }
    case "distortion_rate": {
      const { rows } = await pool.query<{ total: number; distortions: number }>(
        `select count(v.*)::int as total,
                count(v.*) filter (
                  where v.discrepancy_type = any($2::text[])
                )::int as distortions
           from verifications v
           join claims c on c.id = v.claim_id
          where c.org_id = $1`,
        [orgId, DISTORTION_TYPES as unknown as string[]]
      );
      const total = rows[0]?.total ?? 0;
      const distortions = rows[0]?.distortions ?? 0;
      return {
        kind: "metric",
        value: total > 0 ? distortions / total : 0,
        format: "percent",
        label,
      };
    }
    default: {
      // Exhaustiveness guard — should be unreachable given the enum.
      const _never: never = metric;
      return { kind: "metric", value: null, format: "count", label: String(_never) };
    }
  }
}

async function resolveList(
  orgId: string,
  source: string,
  limit: number,
  pool: Pool
): Promise<ListValue> {
  switch (source) {
    case "recent_claims": {
      const { rows } = await pool.query<{ id: string; text: string; created_at: Date | string }>(
        `select id, text, created_at
           from claims
          where org_id = $1
          order by created_at desc
          limit $2`,
        [orgId, limit]
      );
      return {
        kind: "list",
        label: "Recent claims",
        items: rows.map((r) => ({
          id: r.id,
          primary: r.text,
          secondary: new Date(r.created_at).toLocaleDateString(),
        })),
      };
    }
    case "recent_documents": {
      const { rows } = await pool.query<{ id: string; filename: string | null; created_at: Date | string }>(
        `select id, filename, created_at
           from documents
          where org_id = $1
          order by created_at desc
          limit $2`,
        [orgId, limit]
      );
      return {
        kind: "list",
        label: "Recent documents",
        items: rows.map((r) => ({
          id: r.id,
          primary: r.filename ?? "Untitled document",
          secondary: new Date(r.created_at).toLocaleDateString(),
        })),
      };
    }
    case "recent_verifications": {
      const { rows } = await pool.query<{
        id: string;
        discrepancy_type: string | null;
        trust_score: number | null;
        created_at: Date | string;
      }>(
        `select v.id, v.discrepancy_type, v.trust_score, v.created_at
           from verifications v
           join claims c on c.id = v.claim_id
          where c.org_id = $1
          order by v.created_at desc
          limit $2`,
        [orgId, limit]
      );
      return {
        kind: "list",
        label: "Recent verifications",
        items: rows.map((r) => ({
          id: r.id,
          primary: r.discrepancy_type ?? "no_support_found",
          secondary:
            r.trust_score === null ? null : `Trust ${r.trust_score}`,
        })),
      };
    }
    default:
      return { kind: "list", label: "List", items: [] };
  }
}

async function resolveChart(
  orgId: string,
  series: string,
  rangeDays: number,
  pool: Pool
): Promise<ChartValue> {
  switch (series) {
    case "verifications_over_time": {
      const { rows } = await pool.query<{ day: Date; total: number }>(
        `select date_trunc('day', v.created_at) as day, count(v.*)::int as total
           from verifications v
           join claims c on c.id = v.claim_id
          where c.org_id = $1
            and v.created_at >= now() - ($2::int || ' days')::interval
          group by 1
          order by 1 asc`,
        [orgId, rangeDays]
      );
      return {
        kind: "chart",
        label: "Verifications over time",
        series: rows.map((r) => ({
          label: new Date(r.day).toISOString().slice(0, 10),
          value: r.total,
        })),
      };
    }
    case "distortion_by_type": {
      const { rows } = await pool.query<{ discrepancy_type: string | null; c: number }>(
        `select coalesce(v.discrepancy_type, 'no_support_found') as discrepancy_type,
                count(v.*)::int as c
           from verifications v
           join claims c on c.id = v.claim_id
          where c.org_id = $1
          group by v.discrepancy_type
          order by c desc`,
        [orgId]
      );
      return {
        kind: "chart",
        label: "Distortion by type",
        series: rows.map((r) => ({
          label: r.discrepancy_type ?? "no_support_found",
          value: r.c,
        })),
      };
    }
    case "trust_distribution": {
      const { rows } = await pool.query<{ bucket: number; c: number }>(
        `select width_bucket(v.trust_score, 0, 100, 5) as bucket, count(v.*)::int as c
           from verifications v
           join claims c on c.id = v.claim_id
          where c.org_id = $1 and v.trust_score is not null
          group by 1
          order by 1 asc`,
        [orgId]
      );
      const labels = ["0–20", "21–40", "41–60", "61–80", "81–100"];
      const byBucket = new Map<number, number>();
      for (const r of rows) byBucket.set(r.bucket, r.c);
      return {
        kind: "chart",
        label: "Trust distribution",
        series: labels.map((label, i) => ({
          label,
          value: byBucket.get(i + 1) ?? 0,
        })),
      };
    }
    default:
      return { kind: "chart", label: "Chart", series: [] };
  }
}

// Resolve one widget. Never throws: any failure becomes a per-widget error so the
// dashboard degrades gracefully rather than 500-ing on a single bad widget.
async function resolveWidget(
  orgId: string,
  widget: DashboardWidget,
  pool: Pool
): Promise<ResolvedWidget> {
  const title =
    widget.config.title ?? defaultTitle(widget);
  try {
    if (widget.kind === "metric") {
      if (!widget.config.metric) {
        return { widgetId: widget.id, kind: widget.kind, title, data: null, error: "No metric selected." };
      }
      const data = await resolveMetric(orgId, widget.config.metric, pool);
      return { widgetId: widget.id, kind: widget.kind, title, data, error: null };
    }
    if (widget.kind === "list") {
      if (!widget.config.source) {
        return { widgetId: widget.id, kind: widget.kind, title, data: null, error: "No list source selected." };
      }
      const data = await resolveList(orgId, widget.config.source, clampLimit(widget.config.limit), pool);
      return { widgetId: widget.id, kind: widget.kind, title, data, error: null };
    }
    // chart
    if (!widget.config.series) {
      return { widgetId: widget.id, kind: widget.kind, title, data: null, error: "No chart series selected." };
    }
    const data = await resolveChart(orgId, widget.config.series, clampRange(widget.config.rangeDays), pool);
    return { widgetId: widget.id, kind: widget.kind, title, data, error: null };
  } catch {
    return {
      widgetId: widget.id,
      kind: widget.kind,
      title,
      data: null,
      error: "Couldn't resolve this widget's data.",
    };
  }
}

function defaultTitle(widget: DashboardWidget): string {
  if (widget.kind === "metric" && widget.config.metric) {
    return METRIC_LABELS[widget.config.metric];
  }
  if (widget.kind === "list") return "List";
  if (widget.kind === "chart") return "Chart";
  return "Widget";
}

export async function resolveDashboardData(
  orgId: string,
  widgets: DashboardWidget[],
  pool: Pool = getPool()
): Promise<ResolvedWidget[]> {
  // Resolve in parallel; each widget isolates its own failure.
  return Promise.all(widgets.map((w) => resolveWidget(orgId, w, pool)));
}
