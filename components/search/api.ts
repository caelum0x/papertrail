"use client";

import type { SearchResponse, SearchType } from "@/components/search/types";

// Client-side helper for global search. Carries the active org id in the
// 'x-org-id' header (read from localStorage by the console shell) so withOrg
// resolves the right tenant.

const ORG_STORAGE_KEY = "pt_active_org";

function orgHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof window !== "undefined") {
    const orgId = window.localStorage.getItem(ORG_STORAGE_KEY);
    if (orgId) {
      headers["x-org-id"] = orgId;
    }
  }
  return headers;
}

interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export interface SearchQuery {
  q: string;
  type?: SearchType | "";
  signal?: AbortSignal;
}

export async function fetchSearch(query: SearchQuery): Promise<SearchResponse> {
  const params = new URLSearchParams();
  params.set("q", query.q);
  if (query.type) {
    params.set("type", query.type);
  }

  const res = await fetch(`/api/search?${params.toString()}`, {
    headers: orgHeaders(),
    signal: query.signal,
  });
  const body = (await res.json().catch(() => null)) as Envelope<SearchResponse> | null;
  if (!body) {
    throw new Error("Unexpected server response.");
  }
  if (!res.ok || !body.success || !body.data) {
    throw new Error(body.error ?? "Couldn't run the search.");
  }
  return body.data;
}
