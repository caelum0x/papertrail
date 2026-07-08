"use client";

// Client-side fetch helpers for the data export center console pages. Attaches
// the active org id (persisted by the console layout) as the x-org-id header so
// withOrg scopes API calls to the org shown in the switcher, and unwraps the
// { success, data, error, meta } envelope into a small FetchResult shape.

import type { ApiResponse } from "@/lib/api/response";
import type { CreateExportInput } from "@/lib/dataexport/schemas";
import type { DataExport } from "@/lib/dataexport/types";

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

export async function fetchExports(
  page: number,
  limit: number,
  scope?: string
): Promise<FetchResult<DataExport[]>> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (scope) params.set("scope", scope);
  try {
    const res = await fetch(`/api/data-exports?${params.toString()}`, {
      headers: orgHeaders(),
      cache: "no-store",
    });
    return unwrap<DataExport[]>(res);
  } catch {
    return { data: null, error: "Network error loading exports.", total: 0 };
  }
}

export async function fetchExport(
  id: string
): Promise<FetchResult<DataExport>> {
  try {
    const res = await fetch(`/api/data-exports/${id}`, {
      headers: orgHeaders(),
      cache: "no-store",
    });
    return unwrap<DataExport>(res);
  } catch {
    return { data: null, error: "Network error loading export.", total: 0 };
  }
}

export async function startExport(
  input: CreateExportInput
): Promise<FetchResult<DataExport>> {
  try {
    const res = await fetch("/api/data-exports", {
      method: "POST",
      headers: orgHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(input),
    });
    return unwrap<DataExport>(res);
  } catch {
    return { data: null, error: "Network error starting export.", total: 0 };
  }
}

// Triggers a browser download of an export's document from the download route.
// Returns an error string on failure so the caller can surface it.
export async function downloadExport(
  id: string,
  fallbackName: string
): Promise<{ error: string | null }> {
  try {
    const res = await fetch(`/api/data-exports/${id}/download`, {
      headers: orgHeaders(),
      cache: "no-store",
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiResponse<null> | null;
      return { error: body?.error ?? "Download failed." };
    }

    const disposition = res.headers.get("Content-Disposition") ?? "";
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match?.[1] ?? fallbackName;

    const blob = await res.blob();
    if (typeof window !== "undefined") {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    }
    return { error: null };
  } catch {
    return { error: "Network error downloading export." };
  }
}
