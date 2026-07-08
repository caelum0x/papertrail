"use client";

import type { ApiResponse } from "@/lib/api/response";

// Client-side fetch helper for the documents module. Injects the active org id
// (persisted by the console layout) into the x-org-id header so withOrg targets
// the right tenant, and unwraps the standard ApiResponse envelope.

const ORG_STORAGE_KEY = "pt_active_org";

function activeOrgHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const id = window.localStorage.getItem(ORG_STORAGE_KEY);
  return id ? { "x-org-id": id } : {};
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  meta?: ApiResponse<T>["meta"];
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...activeOrgHeader(),
        ...(init?.headers ?? {}),
      },
    });
    const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
    return {
      ok: res.ok && Boolean(body?.success),
      status: res.status,
      data: body?.data ?? null,
      error: body?.error ?? (res.ok ? null : "Request failed."),
      meta: body?.meta,
    };
  } catch {
    return { ok: false, status: 0, data: null, error: "Network error." };
  }
}
