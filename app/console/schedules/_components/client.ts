// Client-side helpers for the schedules console. Each attaches the active org
// id (persisted by the console layout) as x-org-id so withOrg scopes the call.

import type { ApiResponse } from "@/lib/api/response";
import type { Schedule } from "@/lib/jobs/types";

const ORG_STORAGE_KEY = "pt_active_org";

export function orgHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const orgId = window.localStorage.getItem(ORG_STORAGE_KEY);
  return orgId ? { "x-org-id": orgId } : {};
}

export interface SchedulesListResult {
  data: Schedule[];
  total: number;
  error: string | null;
}

export async function fetchSchedules(params: {
  page: number;
  limit: number;
}): Promise<SchedulesListResult> {
  const search = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
  });
  try {
    const res = await fetch(`/api/schedules?${search.toString()}`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    const body: ApiResponse<Schedule[]> = await res.json();
    if (!res.ok || !body.success) {
      return {
        data: [],
        total: 0,
        error: body.error ?? "Failed to load schedules.",
      };
    }
    return { data: body.data ?? [], total: body.meta?.total ?? 0, error: null };
  } catch {
    return { data: [], total: 0, error: "Network error loading schedules." };
  }
}

export function parsePayload(
  raw: string
): { payload: Record<string, unknown>; error: string | null } {
  if (!raw.trim()) return { payload: {}, error: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { payload: parsed as Record<string, unknown>, error: null };
    }
    return { payload: {}, error: "Payload must be a JSON object." };
  } catch {
    return { payload: {}, error: "Payload is not valid JSON." };
  }
}

export async function createSchedule(input: {
  name: string;
  type: string;
  cron: string;
  payload: Record<string, unknown>;
}): Promise<{ data: Schedule | null; error: string | null }> {
  try {
    const res = await fetch("/api/schedules", {
      method: "POST",
      headers: { "content-type": "application/json", ...orgHeaders() },
      body: JSON.stringify(input),
    });
    const body: ApiResponse<Schedule> = await res.json();
    if (!res.ok || !body.success) {
      return { data: null, error: body.error ?? "Failed to create schedule." };
    }
    return { data: body.data ?? null, error: null };
  } catch {
    return { data: null, error: "Network error creating schedule." };
  }
}

export async function toggleSchedule(
  schedule: Schedule
): Promise<{ error: string | null }> {
  try {
    const res = await fetch(`/api/schedules/${schedule.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...orgHeaders() },
      body: JSON.stringify({ enabled: !schedule.enabled }),
    });
    const body: ApiResponse<Schedule> = await res.json();
    if (!res.ok || !body.success) {
      return { error: body.error ?? "Failed to update schedule." };
    }
    return { error: null };
  } catch {
    return { error: "Network error updating schedule." };
  }
}

export async function deleteSchedule(
  id: string
): Promise<{ error: string | null }> {
  try {
    const res = await fetch(`/api/schedules/${id}`, {
      method: "DELETE",
      headers: { ...orgHeaders() },
    });
    const body: ApiResponse<{ deleted: boolean }> = await res.json();
    if (!res.ok || !body.success) {
      return { error: body.error ?? "Failed to delete schedule." };
    }
    return { error: null };
  } catch {
    return { error: "Network error deleting schedule." };
  }
}

export function formatTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
