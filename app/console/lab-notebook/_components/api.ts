"use client";

// Client-side fetch helpers for the Lab Notebook console. Attaches the active org id
// (persisted by the console layout under the shared key) as the x-org-id header so
// withOrg scopes calls to the shown org, and unwraps the { success, data, error, meta }
// envelope into a small result shape. Copied in shape from the connectors console.

import type { ApiResponse } from "@/lib/api/response";
import type {
  CreateExperimentInput,
} from "@/lib/labNotebook/schemas";
import type {
  LabExperimentListItem,
  LabExperimentRecord,
  StructureResponse,
} from "./types";

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
  // HTTP status of the failed response (0 on a network error / no response). Lets callers
  // distinguish an honest "upstream unavailable" (503) from a hard failure so the UI can
  // render a degraded state rather than a red error. Undefined on success.
  status?: number;
}

async function readEnvelope<T>(
  res: Response,
  fallback: string
): Promise<FetchResult<T>> {
  const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!body) {
    return { data: null, error: fallback, total: 0, status: res.status };
  }
  if (!res.ok || !body.success) {
    return { data: null, error: body.error ?? fallback, total: 0, status: res.status };
  }
  return { data: body.data ?? null, error: null, total: body.meta?.total ?? 0 };
}

function qs(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") search.set(k, v);
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

// --- Structure (Claude, not persisted) -------------------------------------

export async function structureNotes(
  notes: string
): Promise<FetchResult<StructureResponse>> {
  try {
    const res = await fetch("/api/lab-notebook/structure", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify({ notes }),
    });
    return await readEnvelope<StructureResponse>(res, "Failed to structure notes.");
  } catch {
    return {
      data: null,
      error:
        "Couldn't reach the structuring service — check your connection and try again.",
      total: 0,
      status: 0,
    };
  }
}

// --- Saved experiments -----------------------------------------------------

export async function listExperiments(
  page: number,
  limit: number,
  q?: string
): Promise<FetchResult<LabExperimentListItem[]>> {
  try {
    const res = await fetch(
      `/api/lab-notebook${qs({ page: String(page), limit: String(limit), q })}`,
      { headers: { ...orgHeaders() }, cache: "no-store" }
    );
    return await readEnvelope<LabExperimentListItem[]>(res, "Failed to load experiments.");
  } catch {
    return { data: null, error: "Network error loading experiments.", total: 0 };
  }
}

export async function getExperiment(
  id: string
): Promise<FetchResult<LabExperimentRecord>> {
  try {
    const res = await fetch(`/api/lab-notebook/${id}`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    return await readEnvelope<LabExperimentRecord>(res, "Failed to load experiment.");
  } catch {
    return { data: null, error: "Network error loading experiment.", total: 0 };
  }
}

export async function createExperiment(
  input: CreateExperimentInput
): Promise<FetchResult<LabExperimentRecord>> {
  try {
    const res = await fetch("/api/lab-notebook", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify(input),
    });
    return await readEnvelope<LabExperimentRecord>(res, "Failed to save experiment.");
  } catch {
    return { data: null, error: "Network error saving experiment.", total: 0 };
  }
}

export async function deleteExperiment(
  id: string
): Promise<FetchResult<{ id: string; deleted: boolean }>> {
  try {
    const res = await fetch(`/api/lab-notebook/${id}`, {
      method: "DELETE",
      headers: { ...orgHeaders() },
    });
    return await readEnvelope<{ id: string; deleted: boolean }>(
      res,
      "Failed to delete experiment."
    );
  } catch {
    return { data: null, error: "Network error deleting experiment.", total: 0 };
  }
}
