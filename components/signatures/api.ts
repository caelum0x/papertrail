"use client";

import type {
  SignatureCertificate,
  SignatureRequest,
  SignatureRequestDetail,
  RequestStatus,
} from "@/lib/signatures/types";

// Client-side API helpers for the e-signature console. Every request carries the
// active org id in the 'x-org-id' header so withOrg resolves the tenant.

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

export interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: { total?: number; page?: number; limit?: number };
}

async function request<T>(
  path: string,
  init?: RequestInit
): Promise<Envelope<T>> {
  try {
    const res = await fetch(path, {
      ...init,
      cache: "no-store",
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...orgHeaders(),
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    const body = (await res.json().catch(() => null)) as Envelope<T> | null;
    if (!body) {
      return { success: false, data: null, error: "Unexpected server response." };
    }
    return body;
  } catch {
    return { success: false, data: null, error: "Network error. Please retry." };
  }
}

// ---- Signature requests --------------------------------------------------

export function fetchRequests(params: {
  status?: RequestStatus;
  entityType?: string;
  page?: number;
  limit?: number;
}): Promise<Envelope<SignatureRequest[]>> {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  if (params.entityType) q.set("entityType", params.entityType);
  q.set("page", String(params.page ?? 1));
  q.set("limit", String(params.limit ?? 20));
  return request<SignatureRequest[]>(`/api/signature-requests?${q.toString()}`);
}

export function fetchRequest(
  id: string
): Promise<Envelope<SignatureRequestDetail>> {
  return request<SignatureRequestDetail>(`/api/signature-requests/${id}`);
}

export function createRequest(input: {
  entityType: string;
  entityId: string;
  title: string;
  signerUserIds?: string[];
}): Promise<Envelope<SignatureRequestDetail>> {
  return request<SignatureRequestDetail>("/api/signature-requests", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function addSigners(
  id: string,
  signerUserIds: string[]
): Promise<Envelope<SignatureRequestDetail>> {
  return request<SignatureRequestDetail>(
    `/api/signature-requests/${id}/signers`,
    { method: "POST", body: JSON.stringify({ signerUserIds }) }
  );
}

export function signRequest(
  id: string,
  mfaMethod: string
): Promise<Envelope<SignatureRequestDetail>> {
  return request<SignatureRequestDetail>(`/api/signature-requests/${id}/sign`, {
    method: "POST",
    body: JSON.stringify({ mfaMethod }),
  });
}

export function cancelRequest(
  id: string
): Promise<Envelope<SignatureRequestDetail>> {
  return request<SignatureRequestDetail>(
    `/api/signature-requests/${id}/cancel`,
    { method: "POST" }
  );
}

export function fetchCertificate(
  id: string
): Promise<Envelope<SignatureCertificate>> {
  return request<SignatureCertificate>(
    `/api/signature-requests/${id}/certificate`
  );
}

// ---- Members (for the signer picker) -------------------------------------
// Consumes the shared /api/members endpoint owned by the org-team module.

export interface OrgMember {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: string;
  joinedAt: string;
}

export function fetchMembers(): Promise<Envelope<OrgMember[]>> {
  return request<OrgMember[]>("/api/members?page=1&limit=100");
}

// Resolves the caller's own user id from the session endpoint, so the detail
// view can tell whether it is this user's turn to sign.
export async function fetchCurrentUserId(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/session", { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!body?.success) return null;
    return body.data?.user?.id ?? null;
  } catch {
    return null;
  }
}
