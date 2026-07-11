"use client";

// Client-side fetch helpers for the trial-matcher console. Attaches the active org id
// (persisted by the console layout under the shared key) as the x-org-id header so withOrg
// scopes calls to the shown org, and unwraps the { success, data, error, meta } envelope
// into a small result shape. Shape copied verbatim from the connectors console api.ts.

import type { ApiResponse } from "@/lib/api/response";
import type { RunResponse, RunDetailResponse, TrialMatchRunRow } from "./types";

const ORG_STORAGE_KEY = "pt_active_org";

function orgHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const orgId = window.localStorage.getItem(ORG_STORAGE_KEY);
  return orgId ? { "x-org-id": orgId } : {};
}

// `status` carries the HTTP status of the response so callers can distinguish a temporary,
// degraded state (e.g. 503 Service Unavailable / a usage-cap surfaced as a 429) from a hard
// 500 server error, and honour Retry-After style backoff without re-parsing the body. It is 0
// when no response was received at all (a network error before any HTTP status existed).
export interface FetchResult<T> {
  data: T | null;
  error: string | null;
  total: number;
  status: number;
}

async function readEnvelope<T>(res: Response, fallback: string): Promise<FetchResult<T>> {
  const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!body) {
    return { data: null, error: fallback, total: 0, status: res.status };
  }
  if (!res.ok || !body.success) {
    return { data: null, error: body.error ?? fallback, total: 0, status: res.status };
  }
  return {
    data: body.data ?? null,
    error: null,
    total: body.meta?.total ?? 0,
    status: res.status,
  };
}

function qs(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") search.set(k, v);
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

// Run a new match from de-identified notes.
export async function runMatch(notes: string): Promise<FetchResult<RunResponse>> {
  try {
    const res = await fetch("/api/trial-matcher", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify({ notes }),
    });
    return await readEnvelope<RunResponse>(res, "Failed to match trials.");
  } catch {
    return { data: null, error: "Network error while matching trials.", total: 0, status: 0 };
  }
}

// List prior match runs for the org.
export async function fetchRuns(
  page: number,
  limit: number
): Promise<FetchResult<TrialMatchRunRow[]>> {
  try {
    const res = await fetch(
      `/api/trial-matcher${qs({ page: String(page), limit: String(limit) })}`,
      { headers: { ...orgHeaders() }, cache: "no-store" }
    );
    return await readEnvelope<TrialMatchRunRow[]>(res, "Failed to load run history.");
  } catch {
    return { data: null, error: "Network error loading run history.", total: 0, status: 0 };
  }
}

// Fetch one prior run with its persisted matches.
export async function fetchRun(id: string): Promise<FetchResult<RunDetailResponse>> {
  try {
    const res = await fetch(`/api/trial-matcher/${id}`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    return await readEnvelope<RunDetailResponse>(res, "Failed to load run.");
  } catch {
    return { data: null, error: "Network error loading run.", total: 0, status: 0 };
  }
}
