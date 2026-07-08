// Shared types for the platform observability module. Kept framework-agnostic
// so both the API route handlers and the client components can import them.

export const ERROR_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;
export type ErrorLevel = (typeof ERROR_LEVELS)[number];

// A single named numeric sample (camelCase, ISO timestamps for the client).
export interface MetricSample {
  id: string;
  metric: string;
  value: number;
  recordedAt: string;
}

// A charting series: evenly-spaced buckets for one metric over a window.
export interface MetricSeriesPoint {
  bucket: string; // ISO timestamp at the start of the bucket
  avg: number;
  min: number;
  max: number;
  count: number;
}

export interface MetricSeries {
  metric: string;
  points: MetricSeriesPoint[];
  latest: number | null;
  total: number;
}

// One application error/warning surfaced to operators.
export interface ErrorEvent {
  id: string;
  level: ErrorLevel;
  message: string;
  context: Record<string, unknown>;
  createdAt: string;
}

// A unified log line — either an app error event or an audit-trail action.
export type LogSource = "error" | "audit";

export interface LogEntry {
  id: string;
  source: LogSource;
  level: ErrorLevel | null; // error-event level; null for audit rows
  message: string; // error message, or the audit action
  actor: string | null; // user email for audit rows; null for error rows
  context: Record<string, unknown>;
  createdAt: string;
}

// Health check result (composed from db reachability + build info).
export type HealthStatus = "ok" | "degraded" | "down";

export interface HealthCheck {
  name: string;
  status: HealthStatus;
  detail: string | null;
  latencyMs: number | null;
}

export interface HealthReport {
  status: HealthStatus;
  checkedAt: string;
  build: {
    commit: string;
    environment: string;
    region: string | null;
    node: string;
  };
  checks: HealthCheck[];
}
