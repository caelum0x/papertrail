// Client-side helpers for the Reporting UI. These run in the browser and attach
// the active org id (persisted by the console layout) as the x-org-id header so
// withOrg scopes API calls to the org shown in the switcher.

import type { ApiResponse } from "@/lib/api/response";
import type {
  ReportDefinition,
  ReportRun,
  ScheduledReport,
  ReportType,
  ReportFormat,
  ReportLayout,
  ReportFilters,
} from "@/lib/reporting/types";

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

async function readEnvelope<T>(
  res: Response,
  fallback: string
): Promise<FetchResult<T>> {
  const body: ApiResponse<T> = await res.json().catch(() => ({
    success: false,
    data: null,
    error: fallback,
  }));
  if (!res.ok || !body.success) {
    return { data: null, error: body.error ?? fallback, total: 0 };
  }
  return { data: body.data, error: null, total: body.meta?.total ?? 0 };
}

// --- Definitions -----------------------------------------------------------

export async function fetchDefinitions(
  type: string | null,
  page: number,
  limit: number
): Promise<FetchResult<ReportDefinition[]>> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (type) params.set("type", type);
  try {
    const res = await fetch(`/api/report-definitions?${params.toString()}`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    return await readEnvelope<ReportDefinition[]>(res, "Failed to load reports.");
  } catch {
    return { data: null, error: "Network error loading reports.", total: 0 };
  }
}

export async function fetchDefinition(
  id: string
): Promise<FetchResult<ReportDefinition>> {
  try {
    const res = await fetch(`/api/report-definitions/${id}`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    return await readEnvelope<ReportDefinition>(res, "Failed to load report.");
  } catch {
    return { data: null, error: "Network error loading report.", total: 0 };
  }
}

export interface DefinitionInput {
  name: string;
  type: ReportType;
  layout: ReportLayout;
  filters: ReportFilters;
}

export async function createDefinition(
  input: DefinitionInput
): Promise<FetchResult<ReportDefinition>> {
  try {
    const res = await fetch(`/api/report-definitions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify(input),
    });
    return await readEnvelope<ReportDefinition>(res, "Failed to create report.");
  } catch {
    return { data: null, error: "Network error creating report.", total: 0 };
  }
}

export async function updateDefinition(
  id: string,
  input: Partial<DefinitionInput>
): Promise<FetchResult<ReportDefinition>> {
  try {
    const res = await fetch(`/api/report-definitions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify(input),
    });
    return await readEnvelope<ReportDefinition>(res, "Failed to update report.");
  } catch {
    return { data: null, error: "Network error updating report.", total: 0 };
  }
}

export async function deleteDefinition(
  id: string
): Promise<FetchResult<{ id: string; deleted: boolean }>> {
  try {
    const res = await fetch(`/api/report-definitions/${id}`, {
      method: "DELETE",
      headers: { ...orgHeaders() },
    });
    return await readEnvelope<{ id: string; deleted: boolean }>(
      res,
      "Failed to delete report."
    );
  } catch {
    return { data: null, error: "Network error deleting report.", total: 0 };
  }
}

export async function runDefinition(
  id: string,
  format: ReportFormat
): Promise<FetchResult<ReportRun>> {
  try {
    const res = await fetch(`/api/report-definitions/${id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify({ format }),
    });
    return await readEnvelope<ReportRun>(res, "Failed to run report.");
  } catch {
    return { data: null, error: "Network error running report.", total: 0 };
  }
}

// --- Runs ------------------------------------------------------------------

export async function fetchRuns(
  definitionId: string | null,
  page: number,
  limit: number
): Promise<FetchResult<ReportRun[]>> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (definitionId) params.set("definitionId", definitionId);
  try {
    const res = await fetch(`/api/report-runs?${params.toString()}`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    return await readEnvelope<ReportRun[]>(res, "Failed to load runs.");
  } catch {
    return { data: null, error: "Network error loading runs.", total: 0 };
  }
}

export async function fetchRun(id: string): Promise<FetchResult<ReportRun>> {
  try {
    const res = await fetch(`/api/report-runs/${id}`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    return await readEnvelope<ReportRun>(res, "Failed to load run.");
  } catch {
    return { data: null, error: "Network error loading run.", total: 0 };
  }
}

// --- Scheduled reports -----------------------------------------------------

export async function fetchSchedules(
  page: number,
  limit: number
): Promise<FetchResult<ScheduledReport[]>> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  try {
    const res = await fetch(`/api/scheduled-reports?${params.toString()}`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    return await readEnvelope<ScheduledReport[]>(res, "Failed to load schedules.");
  } catch {
    return { data: null, error: "Network error loading schedules.", total: 0 };
  }
}

export interface ScheduleInput {
  definitionId: string;
  cron: string;
  recipients: string[];
  enabled: boolean;
}

export async function createSchedule(
  input: ScheduleInput
): Promise<FetchResult<ScheduledReport>> {
  try {
    const res = await fetch(`/api/scheduled-reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify(input),
    });
    return await readEnvelope<ScheduledReport>(res, "Failed to create schedule.");
  } catch {
    return { data: null, error: "Network error creating schedule.", total: 0 };
  }
}

export async function updateSchedule(
  id: string,
  input: Partial<Omit<ScheduleInput, "definitionId">>
): Promise<FetchResult<ScheduledReport>> {
  try {
    const res = await fetch(`/api/scheduled-reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify(input),
    });
    return await readEnvelope<ScheduledReport>(res, "Failed to update schedule.");
  } catch {
    return { data: null, error: "Network error updating schedule.", total: 0 };
  }
}

export async function deleteSchedule(
  id: string
): Promise<FetchResult<{ id: string; deleted: boolean }>> {
  try {
    const res = await fetch(`/api/scheduled-reports/${id}`, {
      method: "DELETE",
      headers: { ...orgHeaders() },
    });
    return await readEnvelope<{ id: string; deleted: boolean }>(
      res,
      "Failed to delete schedule."
    );
  } catch {
    return { data: null, error: "Network error deleting schedule.", total: 0 };
  }
}
