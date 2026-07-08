// Shared, serializable shapes returned by the API-usage analytics endpoints and
// consumed by the console pages. Kept free of `pg`/server-only imports so the
// client components can import them safely.

export interface RouteUsage {
  route: string;
  requests: number;
  errors: number;
  errorRate: number; // 0..1
  avgDurationMs: number | null;
  p95DurationMs: number | null;
}

export interface KeyUsage {
  apiKeyId: string | null;
  keyName: string | null;
  requests: number;
  errors: number;
  errorRate: number; // 0..1
  lastUsedAt: string | null;
}

export interface UsageSummary {
  rangeDays: number;
  totalRequests: number;
  totalErrors: number;
  errorRate: number; // 0..1
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  rateLimitedCount: number;
  activeKeys: number;
  topRoutes: RouteUsage[];
  topKeys: KeyUsage[];
}

export interface TimeseriesPoint {
  bucket: string; // ISO timestamp at the start of the bucket
  requests: number;
  errors: number;
  avgDurationMs: number | null;
}

export interface UsageTimeseries {
  rangeDays: number;
  bucket: "hour" | "day" | "week";
  totalRequests: number;
  points: TimeseriesPoint[];
}

export interface ApiRequestLogItem {
  id: string;
  route: string;
  method: string;
  statusCode: number;
  durationMs: number;
  apiKeyId: string | null;
  keyName: string | null;
  createdAt: string;
}

export interface RateLimitEventItem {
  id: string;
  route: string;
  apiKeyId: string | null;
  keyName: string | null;
  createdAt: string;
}
