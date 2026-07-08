// Client-side helpers for the publication-planning UI. These run in the browser
// and attach the active org id (persisted by the console layout) as the
// x-org-id header so withOrg scopes API calls to the org in the switcher.

import type { ApiResponse } from "@/lib/api/response";
import type {
  MlrDecision,
  MlrReview,
  MlrRole,
  PublicationClaim,
  PublicationReadiness,
  PublicationType,
  PublicationWithCounts,
} from "@/app/api/publications/lib/types";

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

export async function fetchPublications(
  page: number,
  limit: number
): Promise<FetchResult<PublicationWithCounts[]>> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  try {
    const res = await fetch(`/api/publications?${params.toString()}`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    const body: ApiResponse<PublicationWithCounts[]> = await res.json();
    if (!res.ok || !body.success) {
      return {
        data: null,
        error: body.error ?? "Failed to load publications.",
        total: 0,
      };
    }
    return { data: body.data ?? [], error: null, total: body.meta?.total ?? 0 };
  } catch {
    return { data: null, error: "Network error loading publications.", total: 0 };
  }
}

export async function createPublication(input: {
  title: string;
  type: PublicationType;
  targetJournal: string | null;
}): Promise<FetchResult<PublicationWithCounts>> {
  try {
    const res = await fetch("/api/publications", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify(input),
    });
    const body: ApiResponse<PublicationWithCounts> = await res.json();
    if (!res.ok || !body.success) {
      return {
        data: null,
        error: body.error ?? "Failed to create publication.",
        total: 0,
      };
    }
    return { data: body.data, error: null, total: 0 };
  } catch {
    return { data: null, error: "Network error creating publication.", total: 0 };
  }
}

export async function fetchPublication(
  id: string
): Promise<FetchResult<PublicationWithCounts>> {
  try {
    const res = await fetch(`/api/publications/${id}`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    const body: ApiResponse<PublicationWithCounts> = await res.json();
    if (!res.ok || !body.success) {
      return {
        data: null,
        error: body.error ?? "Failed to load publication.",
        total: 0,
      };
    }
    return { data: body.data, error: null, total: 0 };
  } catch {
    return { data: null, error: "Network error loading publication.", total: 0 };
  }
}

export async function updatePublication(
  id: string,
  input: { status?: string; stage?: string }
): Promise<FetchResult<PublicationWithCounts>> {
  try {
    const res = await fetch(`/api/publications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify(input),
    });
    const body: ApiResponse<PublicationWithCounts> = await res.json();
    if (!res.ok || !body.success) {
      return {
        data: null,
        error: body.error ?? "Failed to update publication.",
        total: 0,
      };
    }
    return { data: body.data, error: null, total: 0 };
  } catch {
    return { data: null, error: "Network error updating publication.", total: 0 };
  }
}

export async function fetchPublicationClaims(
  id: string
): Promise<FetchResult<PublicationClaim[]>> {
  try {
    const res = await fetch(`/api/publications/${id}/claims`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    const body: ApiResponse<PublicationClaim[]> = await res.json();
    if (!res.ok || !body.success) {
      return {
        data: null,
        error: body.error ?? "Failed to load attached claims.",
        total: 0,
      };
    }
    return { data: body.data ?? [], error: null, total: 0 };
  } catch {
    return { data: null, error: "Network error loading attached claims.", total: 0 };
  }
}

export async function attachClaims(
  id: string,
  claimIds: string[]
): Promise<FetchResult<{ attached: number; skipped: number }>> {
  try {
    const res = await fetch(`/api/publications/${id}/claims`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify({ claimIds }),
    });
    const body: ApiResponse<{ attached: number; skipped: number }> =
      await res.json();
    if (!res.ok || !body.success) {
      return {
        data: null,
        error: body.error ?? "Failed to attach claims.",
        total: 0,
      };
    }
    return { data: body.data, error: null, total: 0 };
  } catch {
    return { data: null, error: "Network error attaching claims.", total: 0 };
  }
}

export async function fetchReadiness(
  id: string
): Promise<FetchResult<PublicationReadiness>> {
  try {
    const res = await fetch(`/api/publications/${id}/readiness`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    const body: ApiResponse<PublicationReadiness> = await res.json();
    if (!res.ok || !body.success) {
      return {
        data: null,
        error: body.error ?? "Failed to load readiness.",
        total: 0,
      };
    }
    return { data: body.data, error: null, total: 0 };
  } catch {
    return { data: null, error: "Network error loading readiness.", total: 0 };
  }
}

export async function fetchMlrReviews(
  id: string
): Promise<FetchResult<MlrReview[]>> {
  try {
    const res = await fetch(`/api/publications/${id}/mlr`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    const body: ApiResponse<MlrReview[]> = await res.json();
    if (!res.ok || !body.success) {
      return {
        data: null,
        error: body.error ?? "Failed to load MLR reviews.",
        total: 0,
      };
    }
    return { data: body.data ?? [], error: null, total: 0 };
  } catch {
    return { data: null, error: "Network error loading MLR reviews.", total: 0 };
  }
}

export async function submitMlrReview(
  id: string,
  input: { role: MlrRole; decision: MlrDecision; comments: string | null }
): Promise<FetchResult<MlrReview>> {
  try {
    const res = await fetch(`/api/publications/${id}/mlr`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify(input),
    });
    const body: ApiResponse<MlrReview> = await res.json();
    if (!res.ok || !body.success) {
      return {
        data: null,
        error: body.error ?? "Failed to submit MLR review.",
        total: 0,
      };
    }
    return { data: body.data, error: null, total: 0 };
  } catch {
    return { data: null, error: "Network error submitting MLR review.", total: 0 };
  }
}
