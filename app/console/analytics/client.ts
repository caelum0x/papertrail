"use client";

// Client-side fetch helpers + shared types for the analytics console pages.
// Attaches the active org id (persisted by the console layout) as x-org-id so
// withOrg scopes calls to the org in the switcher, and unwraps the
// { success, data, error, meta } envelope into a small FetchResult. Colocated
// with the analytics pages so the module owns its own client layer.

import type { ApiResponse } from "@/lib/api/response";

const ORG_STORAGE_KEY = "pt_active_org";

function orgHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
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

// ---------------------------------------------------------------------------
// Shared response types (mirror the server query/repository shapes).
// ---------------------------------------------------------------------------

export interface DiscrepancyBreakdownItem {
  type: string;
  count: number;
  rate: number;
}

export interface OverviewMetrics {
  claimsVerified: number;
  totalVerifications: number;
  documentsProcessed: number;
  avgTrustScore: number | null;
  distortionRate: number;
  distortionByType: DiscrepancyBreakdownItem[];
}

export interface TimeSeriesPoint {
  date: string;
  total: number;
  distortions: number;
  avgTrustScore: number | null;
}

export interface TrustBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

export interface VerificationAnalytics {
  rangeDays: number;
  totalInRange: number;
  series: TimeSeriesPoint[];
  byType: DiscrepancyBreakdownItem[];
  trustDistribution: TrustBucket[];
}

export interface RegistryOutcomeItem {
  outcome: string;
  count: number;
  rate: number;
}

export interface RegistryAnalytics {
  trialMatchedVerifications: number;
  registryCheckable: number;
  sourcesWithRegisteredResults: number;
  trialSourcesMatched: number;
  outcomeDistribution: RegistryOutcomeItem[];
}

export interface DashboardConfig {
  cards: { kind: string; title?: string }[];
  rangeDays?: number;
}

export interface Dashboard {
  id: string;
  org_id: string;
  name: string;
  config: DashboardConfig;
  created_by: string | null;
  created_at: string;
  created_by_name: string | null;
  created_by_email: string | null;
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

export async function fetchOverview(): Promise<FetchResult<OverviewMetrics>> {
  try {
    const res = await fetch("/api/analytics/overview", {
      headers: orgHeaders(),
      cache: "no-store",
    });
    return unwrap<OverviewMetrics>(res);
  } catch {
    return { data: null, error: "Network error loading analytics.", total: 0 };
  }
}

export async function fetchVerificationAnalytics(
  rangeDays: number
): Promise<FetchResult<VerificationAnalytics>> {
  try {
    const res = await fetch(
      `/api/analytics/verifications?range_days=${encodeURIComponent(String(rangeDays))}`,
      { headers: orgHeaders(), cache: "no-store" }
    );
    return unwrap<VerificationAnalytics>(res);
  } catch {
    return {
      data: null,
      error: "Network error loading verification analytics.",
      total: 0,
    };
  }
}

export async function fetchRegistryAnalytics(): Promise<
  FetchResult<RegistryAnalytics>
> {
  try {
    const res = await fetch("/api/analytics/registry", {
      headers: orgHeaders(),
      cache: "no-store",
    });
    return unwrap<RegistryAnalytics>(res);
  } catch {
    return {
      data: null,
      error: "Network error loading registry analytics.",
      total: 0,
    };
  }
}

export async function fetchDashboards(
  page: number,
  limit: number
): Promise<FetchResult<Dashboard[]>> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  try {
    const res = await fetch(`/api/dashboards?${params.toString()}`, {
      headers: orgHeaders(),
      cache: "no-store",
    });
    return unwrap<Dashboard[]>(res);
  } catch {
    return { data: null, error: "Network error loading dashboards.", total: 0 };
  }
}

export async function createDashboard(input: {
  name: string;
  config: DashboardConfig;
}): Promise<FetchResult<Dashboard>> {
  try {
    const res = await fetch("/api/dashboards", {
      method: "POST",
      headers: orgHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(input),
    });
    return unwrap<Dashboard>(res);
  } catch {
    return { data: null, error: "Network error saving dashboard.", total: 0 };
  }
}

export async function deleteDashboard(
  id: string
): Promise<FetchResult<{ deleted: boolean }>> {
  try {
    const res = await fetch(`/api/dashboards/${id}`, {
      method: "DELETE",
      headers: orgHeaders(),
    });
    return unwrap<{ deleted: boolean }>(res);
  } catch {
    return { data: null, error: "Network error deleting dashboard.", total: 0 };
  }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export const DISCREPANCY_LABELS: Record<string, string> = {
  accurate: "Accurate",
  magnitude_overstated: "Magnitude overstated",
  population_overgeneralized: "Population overgeneralized",
  caveat_dropped: "Caveat dropped",
  no_support_found: "No support found",
};

export function labelFor(type: string): string {
  return DISCREPANCY_LABELS[type] ?? type;
}

export function formatPct(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
