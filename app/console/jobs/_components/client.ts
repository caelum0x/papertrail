// Client-side helpers for the jobs console. Each attaches the active org id
// (persisted by the console layout) as x-org-id so withOrg scopes the call.

import type { ApiResponse } from "@/lib/api/response";
import type { Job } from "@/lib/jobs/types";

const ORG_STORAGE_KEY = "pt_active_org";

export function orgHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const orgId = window.localStorage.getItem(ORG_STORAGE_KEY);
  return orgId ? { "x-org-id": orgId } : {};
}

export interface JobsListResult {
  data: Job[];
  total: number;
  error: string | null;
}

export async function fetchJobs(params: {
  status: string;
  page: number;
  limit: number;
}): Promise<JobsListResult> {
  const search = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
  });
  if (params.status) search.set("status", params.status);
  try {
    const res = await fetch(`/api/jobs?${search.toString()}`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    const body: ApiResponse<Job[]> = await res.json();
    if (!res.ok || !body.success) {
      return { data: [], total: 0, error: body.error ?? "Failed to load jobs." };
    }
    return { data: body.data ?? [], total: body.meta?.total ?? 0, error: null };
  } catch {
    return { data: [], total: 0, error: "Network error loading jobs." };
  }
}

export async function fetchJob(
  id: string
): Promise<{ data: Job | null; error: string | null }> {
  try {
    const res = await fetch(`/api/jobs/${id}`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    const body: ApiResponse<Job> = await res.json();
    if (!res.ok || !body.success) {
      return { data: null, error: body.error ?? "Failed to load job." };
    }
    return { data: body.data ?? null, error: null };
  } catch {
    return { data: null, error: "Network error loading job." };
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

export async function enqueueJob(input: {
  type: string;
  payload: Record<string, unknown>;
}): Promise<{ data: Job | null; error: string | null }> {
  try {
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", ...orgHeaders() },
      body: JSON.stringify(input),
    });
    const body: ApiResponse<Job> = await res.json();
    if (!res.ok || !body.success) {
      return { data: null, error: body.error ?? "Failed to enqueue job." };
    }
    return { data: body.data ?? null, error: null };
  } catch {
    return { data: null, error: "Network error enqueuing job." };
  }
}

export async function retryJob(
  id: string
): Promise<{ error: string | null }> {
  try {
    const res = await fetch(`/api/jobs/${id}/retry`, {
      method: "POST",
      headers: { ...orgHeaders() },
    });
    const body: ApiResponse<Job> = await res.json();
    if (!res.ok || !body.success) {
      return { error: body.error ?? "Failed to retry job." };
    }
    return { error: null };
  } catch {
    return { error: "Network error retrying job." };
  }
}

export async function processTick(): Promise<{
  data: { processedJobs: number; firedSchedules: number } | null;
  error: string | null;
}> {
  try {
    const res = await fetch("/api/jobs/tick", {
      method: "POST",
      headers: { ...orgHeaders() },
    });
    const body: ApiResponse<{
      processedJobs: number;
      firedSchedules: number;
    }> = await res.json();
    if (!res.ok || !body.success) {
      return { data: null, error: body.error ?? "Failed to process tick." };
    }
    return { data: body.data ?? null, error: null };
  } catch {
    return { data: null, error: "Network error processing tick." };
  }
}
