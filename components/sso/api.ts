"use client";

import type {
  SsoConnection,
  SsoProtocol,
  SsoStatus,
  DomainVerifyResult,
  ScimDirectory,
  ScimDirectoryWithToken,
  MfaFactor,
  MfaEnrollment,
} from "@/lib/sso/types";

// Client-side fetch helpers for the SSO / SCIM / MFA module. Forwards the active
// org id in the x-org-id header (persisted by the console layout) so withOrg
// scopes to the correct org, and unwraps the { success, data, error, meta }
// envelope — throwing a user-facing Error on failure so pages can render it.

const ORG_STORAGE_KEY = "pt_active_org";

function activeOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ORG_STORAGE_KEY);
}

function orgHeaders(json: boolean): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (json) headers["Content-Type"] = "application/json";
  const orgId = activeOrgId();
  if (orgId) headers["x-org-id"] = orgId;
  return headers;
}

interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: { total?: number; page?: number; limit?: number };
}

async function unwrap<T>(res: Response): Promise<{ data: T; total: number }> {
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
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

// ---------- SSO connections ----------

export async function fetchConnections(params: {
  page?: number;
  limit?: number;
}): Promise<ListResult<SsoConnection>> {
  const res = await fetch(`/api/sso-connections${qs(params)}`, {
    headers: orgHeaders(false),
  });
  const { data, total } = await unwrap<SsoConnection[]>(res);
  return { items: data, total };
}

export async function fetchConnection(id: string): Promise<SsoConnection> {
  const res = await fetch(`/api/sso-connections/${id}`, {
    headers: orgHeaders(false),
  });
  const { data } = await unwrap<SsoConnection>(res);
  return data;
}

export interface CreateConnectionPayload {
  protocol: SsoProtocol;
  name: string;
  domain?: string;
  config: Record<string, string>;
}

export async function createConnection(
  payload: CreateConnectionPayload
): Promise<SsoConnection> {
  const res = await fetch(`/api/sso-connections`, {
    method: "POST",
    headers: orgHeaders(true),
    body: JSON.stringify(payload),
  });
  const { data } = await unwrap<SsoConnection>(res);
  return data;
}

export interface UpdateConnectionPayload {
  name?: string;
  status?: SsoStatus;
  domain?: string;
  config?: Record<string, string>;
}

export async function updateConnection(
  id: string,
  patch: UpdateConnectionPayload
): Promise<SsoConnection> {
  const res = await fetch(`/api/sso-connections/${id}`, {
    method: "PATCH",
    headers: orgHeaders(true),
    body: JSON.stringify(patch),
  });
  const { data } = await unwrap<SsoConnection>(res);
  return data;
}

export async function deleteConnection(id: string): Promise<void> {
  const res = await fetch(`/api/sso-connections/${id}`, {
    method: "DELETE",
    headers: orgHeaders(false),
  });
  await unwrap<SsoConnection>(res);
}

export async function verifyDomain(id: string): Promise<DomainVerifyResult> {
  const res = await fetch(`/api/sso-connections/${id}/verify-domain`, {
    method: "POST",
    headers: orgHeaders(false),
  });
  const { data } = await unwrap<DomainVerifyResult>(res);
  return data;
}

// ---------- SCIM directories ----------

export async function fetchDirectories(params: {
  page?: number;
  limit?: number;
}): Promise<ListResult<ScimDirectory>> {
  const res = await fetch(`/api/scim-directories${qs(params)}`, {
    headers: orgHeaders(false),
  });
  const { data, total } = await unwrap<ScimDirectory[]>(res);
  return { items: data, total };
}

export async function createDirectory(
  name?: string
): Promise<ScimDirectoryWithToken> {
  const res = await fetch(`/api/scim-directories`, {
    method: "POST",
    headers: orgHeaders(true),
    body: JSON.stringify(name ? { name } : {}),
  });
  const { data } = await unwrap<ScimDirectoryWithToken>(res);
  return data;
}

export async function deleteDirectory(id: string): Promise<void> {
  const res = await fetch(`/api/scim-directories/${id}`, {
    method: "DELETE",
    headers: orgHeaders(false),
  });
  await unwrap<ScimDirectory>(res);
}

// ---------- MFA ----------

export async function fetchFactors(): Promise<MfaFactor[]> {
  const res = await fetch(`/api/mfa/factors`, { headers: orgHeaders(false) });
  const { data } = await unwrap<MfaFactor[]>(res);
  return data;
}

export async function enrollMfa(): Promise<MfaEnrollment> {
  const res = await fetch(`/api/mfa/enroll`, {
    method: "POST",
    headers: orgHeaders(true),
    body: JSON.stringify({ type: "totp" }),
  });
  const { data } = await unwrap<MfaEnrollment>(res);
  return data;
}

export async function verifyMfa(
  factorId: string,
  code: string
): Promise<MfaFactor> {
  const res = await fetch(`/api/mfa/verify`, {
    method: "POST",
    headers: orgHeaders(true),
    body: JSON.stringify({ factorId, code }),
  });
  const { data } = await unwrap<MfaFactor>(res);
  return data;
}

export async function deleteFactor(id: string): Promise<void> {
  const res = await fetch(`/api/mfa/factors/${id}`, {
    method: "DELETE",
    headers: orgHeaders(false),
  });
  await unwrap<MfaFactor>(res);
}
