// Client-side helpers for the systematic-review UI. These run in the browser
// and attach the active org id (persisted by the console layout) as the
// x-org-id header so withOrg scopes API calls to the org in the switcher.

import type { ApiResponse } from "@/lib/api/response";
import type {
  PrismaCounts,
  ScreeningDecision,
  ScreeningStage,
  SrProjectWithCounts,
  SrRecord,
} from "@/app/api/sr-projects/lib/types";

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

export async function fetchSrProjects(
  page: number,
  limit: number
): Promise<FetchResult<SrProjectWithCounts[]>> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  try {
    const res = await fetch(`/api/sr-projects?${params.toString()}`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    const body: ApiResponse<SrProjectWithCounts[]> = await res.json();
    if (!res.ok || !body.success) {
      return { data: null, error: body.error ?? "Failed to load reviews.", total: 0 };
    }
    return { data: body.data ?? [], error: null, total: body.meta?.total ?? 0 };
  } catch {
    return { data: null, error: "Network error loading reviews.", total: 0 };
  }
}

export async function createSrProject(input: {
  name: string;
  question: string;
  inclusionCriteria: string[];
}): Promise<FetchResult<SrProjectWithCounts>> {
  try {
    const res = await fetch("/api/sr-projects", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify(input),
    });
    const body: ApiResponse<SrProjectWithCounts> = await res.json();
    if (!res.ok || !body.success) {
      return { data: null, error: body.error ?? "Failed to create review.", total: 0 };
    }
    return { data: body.data, error: null, total: 0 };
  } catch {
    return { data: null, error: "Network error creating review.", total: 0 };
  }
}

export async function fetchSrProject(
  id: string
): Promise<FetchResult<SrProjectWithCounts>> {
  try {
    const res = await fetch(`/api/sr-projects/${id}`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    const body: ApiResponse<SrProjectWithCounts> = await res.json();
    if (!res.ok || !body.success) {
      return { data: null, error: body.error ?? "Failed to load review.", total: 0 };
    }
    return { data: body.data, error: null, total: 0 };
  } catch {
    return { data: null, error: "Network error loading review.", total: 0 };
  }
}

export async function fetchRecords(
  projectId: string,
  status: string | null,
  page: number,
  limit: number
): Promise<FetchResult<SrRecord[]>> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (status) params.set("status", status);
  try {
    const res = await fetch(
      `/api/sr-projects/${projectId}/records?${params.toString()}`,
      { headers: { ...orgHeaders() }, cache: "no-store" }
    );
    const body: ApiResponse<SrRecord[]> = await res.json();
    if (!res.ok || !body.success) {
      return { data: null, error: body.error ?? "Failed to load records.", total: 0 };
    }
    return { data: body.data ?? [], error: null, total: body.meta?.total ?? 0 };
  } catch {
    return { data: null, error: "Network error loading records.", total: 0 };
  }
}

export async function importRecords(
  projectId: string,
  records: {
    sourceType: string;
    externalId: string | null;
    title: string;
    abstract: string | null;
  }[]
): Promise<FetchResult<{ imported: number; duplicates: number }>> {
  try {
    const res = await fetch(`/api/sr-projects/${projectId}/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify({ records }),
    });
    const body: ApiResponse<{ imported: number; duplicates: number }> =
      await res.json();
    if (!res.ok || !body.success) {
      return { data: null, error: body.error ?? "Failed to import records.", total: 0 };
    }
    return { data: body.data, error: null, total: 0 };
  } catch {
    return { data: null, error: "Network error importing records.", total: 0 };
  }
}

export async function screenRecord(
  recordId: string,
  stage: ScreeningStage,
  decision: ScreeningDecision,
  reason: string | null
): Promise<FetchResult<SrRecord>> {
  try {
    const res = await fetch(`/api/sr-records/${recordId}/screen`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify({ stage, decision, reason }),
    });
    const body: ApiResponse<SrRecord> = await res.json();
    if (!res.ok || !body.success) {
      return { data: null, error: body.error ?? "Failed to screen record.", total: 0 };
    }
    return { data: body.data, error: null, total: 0 };
  } catch {
    return { data: null, error: "Network error screening record.", total: 0 };
  }
}

export async function fetchPrisma(
  projectId: string
): Promise<FetchResult<PrismaCounts>> {
  try {
    const res = await fetch(`/api/sr-projects/${projectId}/prisma`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    const body: ApiResponse<PrismaCounts> = await res.json();
    if (!res.ok || !body.success) {
      return { data: null, error: body.error ?? "Failed to load PRISMA counts.", total: 0 };
    }
    return { data: body.data, error: null, total: 0 };
  } catch {
    return { data: null, error: "Network error loading PRISMA counts.", total: 0 };
  }
}
