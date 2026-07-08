import type {
  ChartSeries,
  ListSource,
  MetricKey,
  WidgetKind,
} from "./types";

// Shared labels, catalogs, and formatting for the dashboard builder UI.

export const WIDGET_KIND_LABELS: Record<WidgetKind, string> = {
  metric: "Metric",
  list: "List",
  chart: "Chart",
};

export const METRIC_OPTIONS: { value: MetricKey; label: string }[] = [
  { value: "claims_verified", label: "Claims verified" },
  { value: "total_verifications", label: "Total verifications" },
  { value: "documents_processed", label: "Documents processed" },
  { value: "avg_trust_score", label: "Average trust score" },
  { value: "distortion_rate", label: "Distortion rate" },
];

export const LIST_OPTIONS: { value: ListSource; label: string }[] = [
  { value: "recent_claims", label: "Recent claims" },
  { value: "recent_documents", label: "Recent documents" },
  { value: "recent_verifications", label: "Recent verifications" },
];

export const CHART_OPTIONS: { value: ChartSeries; label: string }[] = [
  { value: "verifications_over_time", label: "Verifications over time" },
  { value: "distortion_by_type", label: "Distortion by type" },
  { value: "trust_distribution", label: "Trust distribution" },
];

// The default config seeded when a fresh widget of each kind is dropped onto the
// grid, so a new widget resolves to real data immediately.
export const DEFAULT_CONFIG: Record<WidgetKind, Record<string, unknown>> = {
  metric: { metric: "claims_verified" as MetricKey },
  list: { source: "recent_claims" as ListSource, limit: 5 },
  chart: { series: "verifications_over_time" as ChartSeries, rangeDays: 30 },
};

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function formatMetric(
  value: number | null,
  format: "count" | "percent" | "score"
): string {
  if (value === null || value === undefined) return "—";
  if (format === "percent") return `${(value * 100).toFixed(1)}%`;
  if (format === "score") return String(Math.round(value));
  return value.toLocaleString();
}
