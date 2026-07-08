"use client";

// Client-side fetch helpers for the API-usage console pages. Attaches the active
// org id (persisted by the console layout under the same key the reports module
// uses) as the x-org-id header so withOrg scopes calls to the shown org, and
// unwraps the { success, data, error, meta } envelope into a small result shape.

import type { ApiResponse } from "@/lib/api/response";
import type {
  ApiRequestLogItem,
  RateLimitEventItem,
  UsageSummary,
  UsageTimeseries,
} from "@/lib/apiusage/types";

const ORG_STORAGE_KEY = "pt_active_org";

function orgHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof window !== "undefined") {
    const orgId = window.localStorage.getItem(ORG_STORAGE_KEY);
    if (orgId) headers["x-org-id"] = orgId;
  }
  return headers;
}

export interface FetchResult<T> {
  data: T | null;
  error: string | null;
  total: number;
}

async function unwrap<T>(res: Response): Promise<FetchResult<T>> {
  const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!body) {
    return { data: null, error: "Unexpected response from server.", total: 0 };
  }
  if (!res.ok || !body.success) {
    return { data: null, error: body.error ?? "Request failed.", total: 0 };
  }
  return { data: body.data ?? null, error: null, total: body.meta?.total ?? 0 };
}

async function get<T>(
  path: string,
  params: Record<string, string | undefined>,
  networkErrorMessage: string
): Promise<FetchResult<T>> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") search.set(k, v);
  }
  const qs = search.toString();
  try {
    const res = await fetch(`${path}${qs ? `?${qs}` : ""}`, {
      headers: orgHeaders(),
      cache: "no-store",
    });
    return unwrap<T>(res);
  } catch {
    return { data: null, error: networkErrorMessage, total: 0 };
  }
}

export function fetchSummary(days: number): Promise<FetchResult<UsageSummary>> {
  return get<UsageSummary>(
    "/api/api-usage/summary",
    { days: String(days) },
    "Network error loading usage summary."
  );
}

export function fetchTimeseries(
  days: number,
  bucket: string
): Promise<FetchResult<UsageTimeseries>> {
  return get<UsageTimeseries>(
    "/api/api-usage/timeseries",
    { days: String(days), bucket },
    "Network error loading usage timeseries."
  );
}

export interface RequestLogFilters {
  route?: string;
  method?: string;
  status?: string;
}

export function fetchRequests(
  page: number,
  limit: number,
  filters: RequestLogFilters
): Promise<FetchResult<ApiRequestLogItem[]>> {
  return get<ApiRequestLogItem[]>(
    "/api/api-usage/requests",
    {
      page: String(page),
      limit: String(limit),
      route: filters.route,
      method: filters.method,
      status: filters.status,
    },
    "Network error loading request log."
  );
}

export function fetchRateLimits(
  page: number,
  limit: number,
  route?: string
): Promise<FetchResult<RateLimitEventItem[]>> {
  return get<RateLimitEventItem[]>(
    "/api/api-usage/rate-limits",
    { page: String(page), limit: String(limit), route },
    "Network error loading rate-limit events."
  );
}
