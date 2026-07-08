"use client";

// Client-side fetch helpers for the dashboard builder console pages. Attaches the
// active org id (persisted by the console layout) as the x-org-id header so withOrg
// scopes API calls to the org shown in the switcher, and unwraps the
// { success, data, error, meta } envelope into a small FetchResult shape.

import type { ApiResponse } from "@/lib/api/response";
import type {
  Dashboard,
  DashboardData,
  DashboardWidget,
  WidgetConfig,
  WidgetKind,
  WidgetPosition,
} from "./types";

const ORG_STORAGE_KEY = "pt_active_org";

function orgHeaders(json = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (json) headers["Content-Type"] = "application/json";
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

export async function fetchDashboard(
  id: string
): Promise<FetchResult<Dashboard>> {
  try {
    const res = await fetch(`/api/dashboards/${id}`, {
      headers: orgHeaders(),
      cache: "no-store",
    });
    return unwrap<Dashboard>(res);
  } catch {
    return { data: null, error: "Network error loading dashboard.", total: 0 };
  }
}

export interface CreateDashboardBody {
  name: string;
  isDefault?: boolean;
}

export async function createDashboard(
  body: CreateDashboardBody
): Promise<FetchResult<Dashboard>> {
  try {
    const res = await fetch(`/api/dashboards`, {
      method: "POST",
      headers: orgHeaders(true),
      body: JSON.stringify(body),
    });
    return unwrap<Dashboard>(res);
  } catch {
    return { data: null, error: "Network error creating dashboard.", total: 0 };
  }
}

export interface UpdateDashboardBody {
  name?: string;
  isDefault?: boolean;
  layout?: { columns: number; gap: number };
}

export async function updateDashboard(
  id: string,
  body: UpdateDashboardBody
): Promise<FetchResult<Dashboard>> {
  try {
    const res = await fetch(`/api/dashboards/${id}`, {
      method: "PATCH",
      headers: orgHeaders(true),
      body: JSON.stringify(body),
    });
    return unwrap<Dashboard>(res);
  } catch {
    return { data: null, error: "Network error updating dashboard.", total: 0 };
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

export async function fetchWidgets(
  dashboardId: string
): Promise<FetchResult<DashboardWidget[]>> {
  try {
    const res = await fetch(`/api/dashboards/${dashboardId}/widgets`, {
      headers: orgHeaders(),
      cache: "no-store",
    });
    return unwrap<DashboardWidget[]>(res);
  } catch {
    return { data: null, error: "Network error loading widgets.", total: 0 };
  }
}

export interface CreateWidgetBody {
  kind: WidgetKind;
  config?: WidgetConfig;
  position?: WidgetPosition;
}

export async function createWidget(
  dashboardId: string,
  body: CreateWidgetBody
): Promise<FetchResult<DashboardWidget>> {
  try {
    const res = await fetch(`/api/dashboards/${dashboardId}/widgets`, {
      method: "POST",
      headers: orgHeaders(true),
      body: JSON.stringify(body),
    });
    return unwrap<DashboardWidget>(res);
  } catch {
    return { data: null, error: "Network error adding widget.", total: 0 };
  }
}

export interface UpdateWidgetBody {
  config?: WidgetConfig;
  position?: WidgetPosition;
}

export async function updateWidget(
  dashboardId: string,
  widgetId: string,
  body: UpdateWidgetBody
): Promise<FetchResult<DashboardWidget>> {
  try {
    const res = await fetch(
      `/api/dashboards/${dashboardId}/widgets/${widgetId}`,
      {
        method: "PATCH",
        headers: orgHeaders(true),
        body: JSON.stringify(body),
      }
    );
    return unwrap<DashboardWidget>(res);
  } catch {
    return { data: null, error: "Network error updating widget.", total: 0 };
  }
}

export async function deleteWidget(
  dashboardId: string,
  widgetId: string
): Promise<FetchResult<{ deleted: boolean }>> {
  try {
    const res = await fetch(
      `/api/dashboards/${dashboardId}/widgets/${widgetId}`,
      { method: "DELETE", headers: orgHeaders() }
    );
    return unwrap<{ deleted: boolean }>(res);
  } catch {
    return { data: null, error: "Network error deleting widget.", total: 0 };
  }
}

export async function fetchDashboardData(
  dashboardId: string
): Promise<FetchResult<DashboardData>> {
  try {
    const res = await fetch(`/api/dashboards/${dashboardId}/data`, {
      headers: orgHeaders(),
      cache: "no-store",
    });
    return unwrap<DashboardData>(res);
  } catch {
    return { data: null, error: "Network error loading dashboard data.", total: 0 };
  }
}
