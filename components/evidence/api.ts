"use client";

import type { EvidenceItem, EvidenceSourceType } from "@/lib/evidence/types";

// Client-side API helpers for the Evidence library. Every request carries the
// active org id in the 'x-org-id' header (read from localStorage by the console
// shell) so withOrg resolves the right tenant.

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
  meta?: { total?: number; page?: number; limit?: number };
}

async function parse<T>(res: Response): Promise<Envelope<T>> {
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!body) {
    return { success: false, data: null, error: "Unexpected server response." };
  }
  return body;
}

export interface ListEvidenceQuery {
  q?: string;
  type?: EvidenceSourceType | "";
  tag?: string;
  page?: number;
  limit?: number;
}

export interface ListEvidenceResponse {
  items: EvidenceItem[];
  total: number;
}

export async function fetchEvidenceList(
  query: ListEvidenceQuery
): Promise<ListEvidenceResponse> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.type) params.set("type", query.type);
  if (query.tag) params.set("tag", query.tag);
  params.set("page", String(query.page ?? 1));
  params.set("limit", String(query.limit ?? 20));

  const res = await fetch(`/api/evidence?${params.toString()}`, {
    headers: orgHeaders(),
  });
  const body = await parse<EvidenceItem[]>(res);
  if (!res.ok || !body.success || !body.data) {
    throw new Error(body.error ?? "Couldn't load the evidence library.");
  }
  return { items: body.data, total: body.meta?.total ?? body.data.length };
}

export interface CreateEvidencePayload {
  source_type: EvidenceSourceType;
  title: string;
  external_id?: string | null;
  url?: string | null;
  notes?: string | null;
  tags?: string[];
}

export async function createEvidenceItem(
  payload: CreateEvidencePayload
): Promise<EvidenceItem> {
  const res = await fetch("/api/evidence", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...orgHeaders() },
    body: JSON.stringify(payload),
  });
  const body = await parse<EvidenceItem>(res);
  if (!res.ok || !body.success || !body.data) {
    throw new Error(body.error ?? "Couldn't add the evidence item.");
  }
  return body.data;
}

export async function fetchEvidenceItem(id: string): Promise<EvidenceItem> {
  const res = await fetch(`/api/evidence/${id}`, { headers: orgHeaders() });
  const body = await parse<EvidenceItem>(res);
  if (!res.ok || !body.success || !body.data) {
    throw new Error(body.error ?? "Couldn't load this evidence item.");
  }
  return body.data;
}

export async function updateEvidenceItem(
  id: string,
  patch: Partial<CreateEvidencePayload>
): Promise<EvidenceItem> {
  const res = await fetch(`/api/evidence/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...orgHeaders() },
    body: JSON.stringify(patch),
  });
  const body = await parse<EvidenceItem>(res);
  if (!res.ok || !body.success || !body.data) {
    throw new Error(body.error ?? "Couldn't update this evidence item.");
  }
  return body.data;
}

export async function deleteEvidenceItem(id: string): Promise<void> {
  const res = await fetch(`/api/evidence/${id}`, {
    method: "DELETE",
    headers: orgHeaders(),
  });
  const body = await parse<{ deleted: boolean }>(res);
  if (!res.ok || !body.success) {
    throw new Error(body.error ?? "Couldn't delete this evidence item.");
  }
}

export async function addEvidenceTags(
  id: string,
  tags: string[]
): Promise<EvidenceItem> {
  const res = await fetch(`/api/evidence/${id}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...orgHeaders() },
    body: JSON.stringify({ tags }),
  });
  const body = await parse<EvidenceItem>(res);
  if (!res.ok || !body.success || !body.data) {
    throw new Error(body.error ?? "Couldn't update tags.");
  }
  return body.data;
}
