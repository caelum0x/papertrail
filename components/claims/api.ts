// Client-side helpers for the claims module. Every request forwards the active
// org id (persisted by the console layout) via the x-org-id header so withOrg
// scopes the request to the org shown in the topbar switcher.

import type { ApiResponse } from "@/lib/api/response";

const ORG_STORAGE_KEY = "pt_active_org";

function orgHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const orgId = window.localStorage.getItem(ORG_STORAGE_KEY);
  return orgId ? { "x-org-id": orgId } : {};
}

export interface ClaimDto {
  id: string;
  org_id: string;
  project_id: string | null;
  text: string;
  status: string;
  cited_source_url: string | null;
  submitted_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface VerificationDto {
  id: string;
  claim_text: string;
  matched_source_id: string | null;
  discrepancy_type: string | null;
  trust_score: number | null;
  explanation: string | null;
  created_at: string;
}

// Thin wrapper around fetch that always sends the org header, parses the envelope,
// and throws the envelope error message on failure so callers get a clean string.
export async function apiFetch<T>(
  input: string,
  init?: RequestInit
): Promise<ApiResponse<T>> {
  const res = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...orgHeaders(),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!body) {
    throw new Error("Unexpected server response.");
  }
  if (!res.ok || !body.success) {
    throw new Error(body.error ?? "Request failed.");
  }
  return body;
}
