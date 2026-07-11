"use client";

// Client-side fetch helpers for the living-evidence console. Org-scoped calls send
// the active org id (from the shared console key) as x-org-id so withOrg scopes
// them; the public assess call needs no org header. All calls unwrap the standard
// { success, data, error, meta } envelope.

import type { ApiResponse } from "@/lib/api/response";
import type { AssessmentView, MonitorView, StudyInput } from "./types";

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

async function readEnvelope<T>(res: Response, fallback: string): Promise<FetchResult<T>> {
  const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!body) {
    return { data: null, error: fallback, total: 0 };
  }
  if (!res.ok || !body.success) {
    return { data: null, error: body.error ?? fallback, total: 0 };
  }
  return { data: body.data ?? null, error: null, total: body.meta?.total ?? 0 };
}

export async function fetchMonitors(): Promise<FetchResult<MonitorView[]>> {
  try {
    const res = await fetch("/api/evidence/living?limit=50", {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    return await readEnvelope<MonitorView[]>(res, "Failed to load monitors.");
  } catch {
    return { data: null, error: "Network error loading monitors.", total: 0 };
  }
}

export interface CreateMonitorInput {
  topic: string;
  query?: string;
  baseline?: StudyInput[];
}

export async function createMonitor(
  input: CreateMonitorInput
): Promise<FetchResult<MonitorView>> {
  try {
    const res = await fetch("/api/evidence/living", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify(input),
    });
    return await readEnvelope<MonitorView>(res, "Failed to create monitor.");
  } catch {
    return { data: null, error: "Network error creating monitor.", total: 0 };
  }
}

export async function assessLiving(
  studies: StudyInput[],
  candidate: StudyInput
): Promise<FetchResult<AssessmentView>> {
  try {
    const res = await fetch("/api/evidence/living/assess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studies, candidate }),
    });
    return await readEnvelope<AssessmentView>(res, "Failed to assess evidence.");
  } catch {
    return { data: null, error: "Network error assessing evidence.", total: 0 };
  }
}
