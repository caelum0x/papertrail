"use client";

// Client-side fetch helpers for the notifications module. Sends the active org
// id (persisted by the console layout) in the x-org-id header so withOrg scopes
// to the correct org, and unwraps the { success, data, error, meta } envelope.

const ORG_STORAGE_KEY = "pt_active_org";

function activeOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ORG_STORAGE_KEY);
}

export interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: { total?: number; page?: number; limit?: number };
}

function orgHeaders(extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = {};
  const orgId = activeOrgId();
  if (orgId) headers["x-org-id"] = orgId;
  if (extra) {
    for (const [k, v] of Object.entries(extra as Record<string, string>)) {
      headers[k] = v;
    }
  }
  return headers;
}

export async function getJson<T>(url: string): Promise<Envelope<T>> {
  const res = await fetch(url, { headers: orgHeaders() });
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!body) {
    return { success: false, data: null, error: "Unexpected response." };
  }
  return body;
}

export async function sendJson<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  payload?: unknown
): Promise<Envelope<T>> {
  const res = await fetch(url, {
    method,
    headers: orgHeaders({ "Content-Type": "application/json" }),
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!body) {
    return { success: false, data: null, error: "Unexpected response." };
  }
  return body;
}
