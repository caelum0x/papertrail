"use client";

import type {
  SecurityPolicy,
  SecurityPolicyKind,
  IpAllowlistEntry,
  SecurityStatus,
} from "@/lib/security/types";

// Client-side fetch helpers for the Security & data isolation module. Forwards
// the active org id (persisted by the console layout) via the x-org-id header so
// withOrg scopes to the correct org, and unwraps the standard
// { success, data, error, meta } envelope — throwing a user-facing Error on
// failure so pages can surface it in their error state.

const ORG_STORAGE_KEY = "pt_active_org";

function activeOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ORG_STORAGE_KEY);
}

function orgHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const orgId = activeOrgId();
  if (orgId) headers["x-org-id"] = orgId;
  if (extra) {
    for (const [k, v] of Object.entries(extra)) headers[k] = v;
  }
  return headers;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: { total?: number; page?: number; limit?: number };
}

async function unwrap<T>(res: Response): Promise<{ data: T; total: number }> {
  let body: ApiEnvelope<T> | null = null;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    body = null;
  }
  if (!res.ok || !body || !body.success || body.data === null) {
    throw new Error(body?.error ?? "Something went wrong. Please try again.");
  }
  return { data: body.data, total: body.meta?.total ?? 0 };
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

export interface ListResult<T> {
  items: T[];
  total: number;
}

// ---------- policies ----------

export async function fetchPolicies(): Promise<SecurityPolicy[]> {
  const res = await fetch(`/api/security/policies`, { headers: orgHeaders() });
  const { data } = await unwrap<SecurityPolicy[]>(res);
  return data;
}

export interface UpdatePolicyPayload {
  kind: SecurityPolicyKind;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

export async function updatePolicy(
  payload: UpdatePolicyPayload
): Promise<SecurityPolicy> {
  const res = await fetch(`/api/security/policies`, {
    method: "PATCH",
    headers: orgHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  const { data } = await unwrap<SecurityPolicy>(res);
  return data;
}

// ---------- ip allowlist ----------

export async function fetchIpAllowlist(params: {
  page?: number;
  limit?: number;
}): Promise<ListResult<IpAllowlistEntry>> {
  const res = await fetch(`/api/security/ip-allowlist${qs(params)}`, {
    headers: orgHeaders(),
  });
  const { data, total } = await unwrap<IpAllowlistEntry[]>(res);
  return { items: data, total };
}

export interface AddIpPayload {
  cidr: string;
  note?: string;
}

export async function addIpEntry(
  payload: AddIpPayload
): Promise<IpAllowlistEntry> {
  const res = await fetch(`/api/security/ip-allowlist`, {
    method: "POST",
    headers: orgHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  const { data } = await unwrap<IpAllowlistEntry>(res);
  return data;
}

export async function deleteIpEntry(id: string): Promise<void> {
  const res = await fetch(`/api/security/ip-allowlist/${id}`, {
    method: "DELETE",
    headers: orgHeaders(),
  });
  await unwrap<{ deleted: boolean }>(res);
}

// ---------- status ----------

export async function fetchSecurityStatus(): Promise<SecurityStatus> {
  const res = await fetch(`/api/security/status`, { headers: orgHeaders() });
  const { data } = await unwrap<SecurityStatus>(res);
  return data;
}
