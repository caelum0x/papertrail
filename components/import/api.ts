"use client";

import type {
  ImportBatch,
  ImportFormat,
  ImportRow,
  ImportTarget,
} from "@/lib/import/types";

// Client-side fetch helpers for the bulk import console. Reads the active org id
// from localStorage (set by the console shell's org switcher) and forwards it as
// the x-org-id header so withOrg scopes each request to the right tenant.

const ORG_STORAGE_KEY = "pt_active_org";

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: { total?: number; page?: number; limit?: number };
}

export interface BatchDetail {
  batch: ImportBatch;
  rows: ImportRow[];
}

export interface ReferenceLibraryDto {
  id: string;
  name: string;
}

export function orgHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const orgId = window.localStorage.getItem(ORG_STORAGE_KEY);
  return orgId ? { "x-org-id": orgId } : {};
}

export async function apiGet<T>(path: string): Promise<ApiEnvelope<T>> {
  try {
    const res = await fetch(path, { headers: { ...orgHeaders() }, cache: "no-store" });
    const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (!body) {
      return { success: false, data: null, error: `Request failed (${res.status}).` };
    }
    return body;
  } catch {
    return { success: false, data: null, error: "Network error. Please retry." };
  }
}

export async function apiSend<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  payload?: unknown
): Promise<ApiEnvelope<T>> {
  try {
    const res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (!body) {
      return { success: false, data: null, error: `Request failed (${res.status}).` };
    }
    return body;
  } catch {
    return { success: false, data: null, error: "Network error. Please retry." };
  }
}

// --- typed endpoint wrappers ---------------------------------------------

export function listBatches(page: number, limit: number) {
  return apiGet<ImportBatch[]>(`/api/imports?page=${page}&limit=${limit}`);
}

export function getBatch(id: string, page: number, limit: number) {
  return apiGet<BatchDetail>(`/api/imports/${id}?page=${page}&limit=${limit}`);
}

export interface CreateBatchPayload {
  target: ImportTarget;
  format: ImportFormat;
  text: string;
  mapping: Record<string, string>;
  libraryId?: string;
}

export function createBatch(payload: CreateBatchPayload) {
  return apiSend<ImportBatch>("/api/imports", "POST", payload);
}

export function commitBatch(
  id: string,
  payload: { mapping?: Record<string, string>; libraryId?: string }
) {
  return apiSend<ImportBatch>(`/api/imports/${id}/commit`, "POST", payload);
}

// Reference libraries feed the references-target library picker in the wizard.
export function listLibraries() {
  return apiGet<ReferenceLibraryDto[]>(`/api/reference-libraries?page=1&limit=100`);
}
