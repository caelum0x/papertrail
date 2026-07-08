"use client";

import type {
  ErrorEvent,
  HealthReport,
  LogEntry,
  MetricSeries,
} from "@/lib/observability/types";

// Client-side API helpers for the observability console. Every request carries
// the active org id in the 'x-org-id' header so withOrg resolves the tenant.

const ORG_STORAGE_KEY = "pt_active_org";

function orgHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof window !== "undefined") {
    const orgId = window.localStorage.getItem(ORG_STORAGE_KEY);
    if (orgId) {
      headers["x-org-id"] = orgId;
    }
  }
  return headers;
}

export interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: { total?: number; page?: number; limit?: number };
}

async function request<T>(
  path: string,
  init?: RequestInit
): Promise<Envelope<T>> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...orgHeaders(),
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    const body = (await res.json().catch(() => null)) as Envelope<T> | null;
    if (!body) {
      return { success: false, data: null, error: "Unexpected server response." };
    }
    return body;
  } catch {
    return { success: false, data: null, error: "Network error. Please retry." };
  }
}

export function fetchHealth(): Promise<Envelope<HealthReport>> {
  return request<HealthReport>("/api/observability/health");
}

export interface MetricsResponse {
  metrics: string[];
  window: string;
  series: MetricSeries[];
}

export function fetchMetrics(params: {
  metric?: string;
  window?: string;
  buckets?: number;
}): Promise<Envelope<MetricsResponse>> {
  const q = new URLSearchParams();
  if (params.metric) q.set("metric", params.metric);
  if (params.window) q.set("window", params.window);
  if (params.buckets) q.set("buckets", String(params.buckets));
  return request<MetricsResponse>(`/api/observability/metrics?${q.toString()}`);
}

export function fetchLogs(params: {
  source?: string;
  level?: string;
  q?: string;
  page?: number;
  limit?: number;
}): Promise<Envelope<LogEntry[]>> {
  const q = new URLSearchParams();
  if (params.source) q.set("source", params.source);
  if (params.level) q.set("level", params.level);
  if (params.q) q.set("q", params.q);
  q.set("page", String(params.page ?? 1));
  q.set("limit", String(params.limit ?? 25));
  return request<LogEntry[]>(`/api/observability/logs?${q.toString()}`);
}

export function fetchErrors(params: {
  level?: string;
  q?: string;
  page?: number;
  limit?: number;
}): Promise<Envelope<ErrorEvent[]>> {
  const q = new URLSearchParams();
  if (params.level) q.set("level", params.level);
  if (params.q) q.set("q", params.q);
  q.set("page", String(params.page ?? 1));
  q.set("limit", String(params.limit ?? 20));
  return request<ErrorEvent[]>(`/api/observability/errors?${q.toString()}`);
}

export function fetchError(id: string): Promise<Envelope<ErrorEvent>> {
  return request<ErrorEvent>(`/api/observability/errors/${id}`);
}

export function ingestError(input: {
  level?: string;
  message: string;
  context?: Record<string, unknown>;
}): Promise<Envelope<ErrorEvent>> {
  return request<ErrorEvent>("/api/observability/errors", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
