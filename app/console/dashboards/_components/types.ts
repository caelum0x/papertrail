// Client-side mirror of the dashboard builder API shapes. Kept colocated with the
// console pages so the UI depends only on its own module.

export type WidgetKind = "metric" | "list" | "chart";

export type MetricKey =
  | "claims_verified"
  | "total_verifications"
  | "documents_processed"
  | "avg_trust_score"
  | "distortion_rate";

export type ListSource =
  | "recent_claims"
  | "recent_documents"
  | "recent_verifications";

export type ChartSeries =
  | "verifications_over_time"
  | "distortion_by_type"
  | "trust_distribution";

export interface DashboardLayout {
  columns: number;
  gap: number;
}

export interface WidgetPosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WidgetConfig {
  title?: string;
  metric?: MetricKey;
  source?: ListSource;
  series?: ChartSeries;
  limit?: number;
  rangeDays?: number;
}

export interface Dashboard {
  id: string;
  org_id: string;
  name: string;
  layout: DashboardLayout;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
  created_by_name: string | null;
  created_by_email: string | null;
  widget_count: number;
}

export interface DashboardWidget {
  id: string;
  org_id: string;
  dashboard_id: string;
  kind: WidgetKind;
  config: WidgetConfig;
  position: WidgetPosition;
  created_at: string;
}

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
  kind: WidgetKind;
  title: string;
  data: ResolvedData;
  error: string | null;
}

export interface DashboardData {
  dashboardId: string;
  name: string;
  widgets: ResolvedWidget[];
}
