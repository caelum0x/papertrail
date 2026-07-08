"use client";

import type {
  Experiment,
  ExperimentStatus,
  ExperimentVariant,
  FeatureFlag,
  FlagEvaluation,
  FlagRule,
} from "@/lib/flags/types";

// Client-side API helpers for the feature-flags & experiments console. Every
// request carries the active org id in the 'x-org-id' header so withOrg
// resolves the tenant.

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

// ---- Feature flags -------------------------------------------------------

export function fetchFlags(params: {
  q?: string;
  page?: number;
  limit?: number;
}): Promise<Envelope<FeatureFlag[]>> {
  const q = new URLSearchParams();
  if (params.q) q.set("q", params.q);
  q.set("page", String(params.page ?? 1));
  q.set("limit", String(params.limit ?? 20));
  return request<FeatureFlag[]>(`/api/feature-flags?${q.toString()}`);
}

export function fetchFlag(id: string): Promise<Envelope<FeatureFlag>> {
  return request<FeatureFlag>(`/api/feature-flags/${id}`);
}

export function createFlag(input: {
  key: string;
  description?: string | null;
  enabled?: boolean;
  rolloutPercent?: number;
  rules?: FlagRule[];
}): Promise<Envelope<FeatureFlag>> {
  return request<FeatureFlag>("/api/feature-flags", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateFlag(
  id: string,
  patch: {
    description?: string | null;
    enabled?: boolean;
    rolloutPercent?: number;
    rules?: FlagRule[];
  }
): Promise<Envelope<FeatureFlag>> {
  return request<FeatureFlag>(`/api/feature-flags/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteFlag(id: string): Promise<Envelope<FeatureFlag>> {
  return request<FeatureFlag>(`/api/feature-flags/${id}`, { method: "DELETE" });
}

export interface FlagAuditEntry {
  id: string;
  action: string;
  userId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export function fetchFlagAudit(
  id: string
): Promise<Envelope<FlagAuditEntry[]>> {
  return request<FlagAuditEntry[]>(`/api/feature-flags/${id}/audit`);
}

export function evaluateFlag(params: {
  key: string;
  subject: string;
  attributes?: Record<string, string>;
}): Promise<Envelope<FlagEvaluation>> {
  const q = new URLSearchParams();
  q.set("key", params.key);
  q.set("subject", params.subject);
  for (const [name, value] of Object.entries(params.attributes ?? {})) {
    if (name && value) q.set(name, value);
  }
  return request<FlagEvaluation>(`/api/feature-flags/evaluate?${q.toString()}`);
}

// ---- Experiments ---------------------------------------------------------

export function fetchExperiments(params: {
  status?: ExperimentStatus;
  page?: number;
  limit?: number;
}): Promise<Envelope<Experiment[]>> {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  q.set("page", String(params.page ?? 1));
  q.set("limit", String(params.limit ?? 20));
  return request<Experiment[]>(`/api/experiments?${q.toString()}`);
}

export function fetchExperiment(id: string): Promise<Envelope<Experiment>> {
  return request<Experiment>(`/api/experiments/${id}`);
}

export function createExperiment(input: {
  key: string;
  name: string;
  status?: ExperimentStatus;
  variants?: ExperimentVariant[];
}): Promise<Envelope<Experiment>> {
  return request<Experiment>("/api/experiments", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateExperiment(
  id: string,
  patch: {
    name?: string;
    status?: ExperimentStatus;
    variants?: ExperimentVariant[];
  }
): Promise<Envelope<Experiment>> {
  return request<Experiment>(`/api/experiments/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
