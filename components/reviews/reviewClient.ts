// Client-side helpers for the reviews UI. These run in the browser and attach
// the active org id (persisted by the console layout) as the x-org-id header so
// withOrg scopes API calls to the org shown in the switcher.

import type { ApiResponse } from "@/lib/api/response";
import type { ReviewWithPeople } from "@/lib/reviews/types";

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

export async function fetchReviews(
  scope: "mine" | "all",
  status: string | null,
  page: number,
  limit: number
): Promise<FetchResult<ReviewWithPeople[]>> {
  const params = new URLSearchParams({
    scope,
    page: String(page),
    limit: String(limit),
  });
  if (status) params.set("status", status);

  try {
    const res = await fetch(`/api/reviews?${params.toString()}`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    const body: ApiResponse<ReviewWithPeople[]> = await res.json();
    if (!res.ok || !body.success) {
      return { data: null, error: body.error ?? "Failed to load reviews.", total: 0 };
    }
    return { data: body.data ?? [], error: null, total: body.meta?.total ?? 0 };
  } catch {
    return { data: null, error: "Network error loading reviews.", total: 0 };
  }
}

export async function fetchReview(
  id: string
): Promise<FetchResult<ReviewWithPeople>> {
  try {
    const res = await fetch(`/api/reviews/${id}`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    const body: ApiResponse<ReviewWithPeople> = await res.json();
    if (!res.ok || !body.success) {
      return { data: null, error: body.error ?? "Failed to load review.", total: 0 };
    }
    return { data: body.data, error: null, total: 0 };
  } catch {
    return { data: null, error: "Network error loading review.", total: 0 };
  }
}

export async function submitDecision(
  id: string,
  decision: "approved" | "rejected",
  comment: string
): Promise<FetchResult<ReviewWithPeople>> {
  try {
    const res = await fetch(`/api/reviews/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify({
        decision,
        comment: comment.trim() ? comment.trim() : null,
      }),
    });
    const body: ApiResponse<ReviewWithPeople> = await res.json();
    if (!res.ok || !body.success) {
      return { data: null, error: body.error ?? "Failed to submit decision.", total: 0 };
    }
    return { data: body.data, error: null, total: 0 };
  } catch {
    return { data: null, error: "Network error submitting decision.", total: 0 };
  }
}
