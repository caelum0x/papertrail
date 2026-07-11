"use client";

// Client-side fetch helpers for the data-governance console. Attaches the active
// org id (persisted by the console layout) as the x-org-id header so withOrg
// scopes calls to the shown org, and unwraps the { success, data, error, meta }
// envelope into a small result shape.

import type { ApiResponse } from "@/lib/api/response";
import type { LegalHold } from "@/lib/governance/legalHold";
import type { DsarExport } from "@/lib/governance/dsar";

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

async function readEnvelope<T>(
  res: Response,
  fallback: string
): Promise<FetchResult<T>> {
  const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!body) {
    return { data: null, error: fallback, total: 0 };
  }
  if (!res.ok || !body.success) {
    return { data: null, error: body.error ?? fallback, total: 0 };
  }
  return { data: body.data ?? null, error: null, total: body.meta?.total ?? 0 };
}

// --- Legal holds -----------------------------------------------------------

export async function fetchLegalHolds(
  activeOnly: boolean
): Promise<FetchResult<LegalHold[]>> {
  try {
    const suffix = activeOnly ? "?active=true" : "";
    const res = await fetch(`/api/governance/legal-hold${suffix}`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    return await readEnvelope<LegalHold[]>(res, "Failed to load legal holds.");
  } catch {
    return { data: null, error: "Network error loading legal holds.", total: 0 };
  }
}

export async function placeHold(input: {
  subject: string;
  reason?: string;
}): Promise<FetchResult<LegalHold>> {
  try {
    const res = await fetch("/api/governance/legal-hold", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify(input),
    });
    return await readEnvelope<LegalHold>(res, "Failed to place the legal hold.");
  } catch {
    return { data: null, error: "Network error placing the legal hold.", total: 0 };
  }
}

export async function releaseHold(id: string): Promise<FetchResult<LegalHold>> {
  try {
    const res = await fetch(`/api/governance/legal-hold?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { ...orgHeaders() },
    });
    return await readEnvelope<LegalHold>(res, "Failed to release the legal hold.");
  } catch {
    return { data: null, error: "Network error releasing the legal hold.", total: 0 };
  }
}

// --- DSAR ------------------------------------------------------------------

export async function runDsar(
  subjectEmail: string
): Promise<FetchResult<DsarExport>> {
  try {
    const res = await fetch("/api/governance/dsar", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify({ subjectEmail }),
    });
    return await readEnvelope<DsarExport>(res, "Failed to assemble the DSAR export.");
  } catch {
    return { data: null, error: "Network error assembling the DSAR export.", total: 0 };
  }
}

// Triggers a browser download of the DSAR package as a JSON attachment. Returns an
// error string on failure, or null on success (the download starts as a side effect).
export async function downloadDsar(subjectEmail: string): Promise<string | null> {
  try {
    const res = await fetch("/api/governance/dsar?format=json", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify({ subjectEmail }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiResponse<unknown> | null;
      return body?.error ?? "Failed to download the DSAR export.";
    }
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const match = /filename="([^"]+)"/.exec(disposition);
    const filename = match?.[1] ?? "dsar-export.json";

    const objectUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(objectUrl);
    return null;
  } catch {
    return "Network error downloading the DSAR export.";
  }
}
