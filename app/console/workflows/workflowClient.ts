// Client-side helpers for the workflows console. These run in the browser and
// attach the active org id (persisted by the console layout) as x-org-id so
// withOrg scopes API calls to the org shown in the switcher.

import type { ApiResponse } from "@/lib/api/response";
import type { WorkflowDefinition } from "@/lib/workflows/types";
import type {
  CustomWorkflow,
  RunSummary,
  RunDetail,
} from "@/lib/workflows/repository";
import type { WorkflowRunResult } from "@/lib/workflows/runner";

const ORG_STORAGE_KEY = "pt_active_org";

function orgHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const orgId = window.localStorage.getItem(ORG_STORAGE_KEY);
  return orgId ? { "x-org-id": orgId } : {};
}

export interface FetchResult<T> {
  data: T | null;
  error: string | null;
  total: number;
}

export interface WorkflowsPayload {
  builtin: WorkflowDefinition[];
  custom: CustomWorkflow[];
}

export interface WorkflowDetail {
  id: string;
  source: "builtin" | "custom";
  name: string;
  description: string | null;
  definition: WorkflowDefinition;
  createdBy?: string | null;
  createdAt?: string;
}

export async function fetchWorkflows(): Promise<FetchResult<WorkflowsPayload>> {
  try {
    const res = await fetch(`/api/agent-workflows?limit=100`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    const body: ApiResponse<WorkflowsPayload> = await res.json();
    if (!res.ok || !body.success || !body.data) {
      return { data: null, error: body.error ?? "Failed to load workflows.", total: 0 };
    }
    return { data: body.data, error: null, total: body.meta?.total ?? 0 };
  } catch {
    return { data: null, error: "Network error loading workflows.", total: 0 };
  }
}

export async function fetchWorkflow(
  id: string
): Promise<FetchResult<WorkflowDetail>> {
  try {
    const res = await fetch(`/api/agent-workflows/${encodeURIComponent(id)}`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    const body: ApiResponse<WorkflowDetail> = await res.json();
    if (!res.ok || !body.success || !body.data) {
      return { data: null, error: body.error ?? "Failed to load workflow.", total: 0 };
    }
    return { data: body.data, error: null, total: 0 };
  } catch {
    return { data: null, error: "Network error loading workflow.", total: 0 };
  }
}

export async function fetchRuns(
  workflowKey: string | null,
  page: number,
  limit: number
): Promise<FetchResult<RunSummary[]>> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (workflowKey) params.set("workflowKey", workflowKey);
  try {
    const res = await fetch(`/api/agent-runs?${params.toString()}`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    const body: ApiResponse<RunSummary[]> = await res.json();
    if (!res.ok || !body.success) {
      return { data: null, error: body.error ?? "Failed to load runs.", total: 0 };
    }
    return { data: body.data ?? [], error: null, total: body.meta?.total ?? 0 };
  } catch {
    return { data: null, error: "Network error loading runs.", total: 0 };
  }
}

export async function fetchRun(id: string): Promise<FetchResult<RunDetail>> {
  try {
    const res = await fetch(`/api/agent-runs/${id}`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    const body: ApiResponse<RunDetail> = await res.json();
    if (!res.ok || !body.success || !body.data) {
      return { data: null, error: body.error ?? "Failed to load run.", total: 0 };
    }
    return { data: body.data, error: null, total: 0 };
  } catch {
    return { data: null, error: "Network error loading run.", total: 0 };
  }
}

export async function startRun(
  workflowKey: string,
  claim: string
): Promise<FetchResult<WorkflowRunResult>> {
  try {
    const res = await fetch(`/api/agent-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify({ workflowKey, claim: claim.trim() }),
    });
    const body: ApiResponse<WorkflowRunResult> = await res.json();
    if (!res.ok || !body.success || !body.data) {
      return { data: null, error: body.error ?? "Failed to start run.", total: 0 };
    }
    return { data: body.data, error: null, total: 0 };
  } catch {
    return { data: null, error: "Network error starting run.", total: 0 };
  }
}
