"use client";

// Client-side fetch helpers for the reports & exports console pages. Attaches the
// active org id (persisted by the console layout) as the x-org-id header so withOrg
// scopes API calls to the org shown in the switcher, and unwraps the
// { success, data, error, meta } envelope into a small FetchResult shape.

import type { ApiResponse } from "@/lib/api/response";
import type {
  CreateExportInput,
  CreateReportInput,
} from "@/lib/reports-exports/schemas";
import type { ExportJob, Report } from "@/lib/reports-exports/types";

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

export async function fetchReports(
  page: number,
  limit: number,
  type?: string
): Promise<FetchResult<Report[]>> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (type) params.set("type", type);
  try {
    const res = await fetch(`/api/reports?${params.toString()}`, {
      headers: orgHeaders(),
      cache: "no-store",
    });
    return unwrap<Report[]>(res);
  } catch {
    return { data: null, error: "Network error loading reports.", total: 0 };
  }
}

export async function fetchReport(id: string): Promise<FetchResult<Report>> {
  try {
    const res = await fetch(`/api/reports/${id}`, {
      headers: orgHeaders(),
      cache: "no-store",
    });
    return unwrap<Report>(res);
  } catch {
    return { data: null, error: "Network error loading report.", total: 0 };
  }
}

export async function createReport(
  input: CreateReportInput
): Promise<FetchResult<Report>> {
  try {
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: orgHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(input),
    });
    return unwrap<Report>(res);
  } catch {
    return { data: null, error: "Network error creating report.", total: 0 };
  }
}

export async function deleteReport(
  id: string
): Promise<FetchResult<{ deleted: boolean }>> {
  try {
    const res = await fetch(`/api/reports/${id}`, {
      method: "DELETE",
      headers: orgHeaders(),
    });
    return unwrap<{ deleted: boolean }>(res);
  } catch {
    return { data: null, error: "Network error deleting report.", total: 0 };
  }
}

export async function fetchExportJobs(
  page: number,
  limit: number
): Promise<FetchResult<ExportJob[]>> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  try {
    const res = await fetch(`/api/exports?${params.toString()}`, {
      headers: orgHeaders(),
      cache: "no-store",
    });
    return unwrap<ExportJob[]>(res);
  } catch {
    return { data: null, error: "Network error loading export history.", total: 0 };
  }
}

export interface RunExportResult {
  error: string | null;
  filename: string | null;
  rowCount: number | null;
}

// Runs an export and triggers a browser download of the returned document. Returns
// metadata (or an error) so the caller can refresh the job history / show a toast.
export async function runExport(
  input: CreateExportInput
): Promise<RunExportResult> {
  try {
    const res = await fetch("/api/exports", {
      method: "POST",
      headers: orgHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      // Error responses use the JSON envelope; a document response is a 200.
      const body = (await res.json().catch(() => null)) as ApiResponse<null> | null;
      return {
        error: body?.error ?? "Export failed.",
        filename: null,
        rowCount: null,
      };
    }

    const disposition = res.headers.get("Content-Disposition") ?? "";
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match?.[1] ?? `papertrail-${input.type}.${input.format === "csv" ? "csv" : "md"}`;
    const rowCountHeader = res.headers.get("X-Export-Row-Count");
    const rowCount = rowCountHeader ? Number(rowCountHeader) : null;

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

    return { error: null, filename, rowCount };
  } catch {
    return { error: "Network error running export.", filename: null, rowCount: null };
  }
}
