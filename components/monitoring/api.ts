import type {
  Monitor,
  MonitorHit,
  MonitorHitStatus,
  MonitorSourceType,
  MonitorFrequency,
  AeSignal,
  AeSeverity,
  AeStatus,
} from "@/lib/monitoring/types";

// Client-side fetch helpers for the monitoring module. Each unwraps the standard
// { success, data, error, meta } envelope and throws a user-facing Error on
// failure so pages can surface it in their error state.

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
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

// ---------- monitors ----------

export interface ListResult<T> {
  items: T[];
  total: number;
}

export async function fetchMonitors(params: {
  page?: number;
  limit?: number;
}): Promise<ListResult<Monitor>> {
  const res = await fetch(`/api/monitors${qs(params)}`, {
    headers: { Accept: "application/json" },
  });
  const { data, total } = await unwrap<Monitor[]>(res);
  return { items: data, total };
}

export interface CreateMonitorPayload {
  name: string;
  query: string;
  sources: MonitorSourceType[];
  frequency: MonitorFrequency;
  enabled: boolean;
}

export async function createMonitor(
  payload: CreateMonitorPayload
): Promise<Monitor> {
  const res = await fetch(`/api/monitors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const { data } = await unwrap<Monitor>(res);
  return data;
}

export async function updateMonitor(
  id: string,
  patch: Partial<CreateMonitorPayload>
): Promise<Monitor> {
  const res = await fetch(`/api/monitors/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const { data } = await unwrap<Monitor>(res);
  return data;
}

export async function deleteMonitor(id: string): Promise<void> {
  const res = await fetch(`/api/monitors/${id}`, { method: "DELETE" });
  await unwrap<{ deleted: boolean }>(res);
}

export interface RunMonitorResult {
  monitor_id: string;
  considered: number;
  new_hits: number;
}

export async function runMonitor(id: string): Promise<RunMonitorResult> {
  const res = await fetch(`/api/monitors/${id}/run`, { method: "POST" });
  const { data } = await unwrap<RunMonitorResult>(res);
  return data;
}

export async function fetchMonitor(id: string): Promise<Monitor> {
  // No dedicated GET/[id]; fetch the list and find it. The list is small per org.
  const { items } = await fetchMonitors({ limit: 100 });
  const found = items.find((m) => m.id === id);
  if (!found) {
    throw new Error("Monitor not found.");
  }
  return found;
}

// ---------- hits ----------

export async function fetchHits(
  monitorId: string,
  params: { status?: MonitorHitStatus | ""; page?: number; limit?: number }
): Promise<ListResult<MonitorHit>> {
  const res = await fetch(
    `/api/monitors/${monitorId}/hits${qs({
      status: params.status || undefined,
      page: params.page,
      limit: params.limit,
    })}`,
    { headers: { Accept: "application/json" } }
  );
  const { data, total } = await unwrap<MonitorHit[]>(res);
  return { items: data, total };
}

export async function triageHit(
  hitId: string,
  status: MonitorHitStatus
): Promise<MonitorHit> {
  const res = await fetch(`/api/monitor-hits/${hitId}/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const { data } = await unwrap<MonitorHit>(res);
  return data;
}

// ---------- ae signals ----------

export async function fetchSignals(params: {
  status?: AeStatus | "";
  severity?: AeSeverity | "";
  drug?: string;
  page?: number;
  limit?: number;
}): Promise<ListResult<AeSignal>> {
  const res = await fetch(
    `/api/ae-signals${qs({
      status: params.status || undefined,
      severity: params.severity || undefined,
      drug: params.drug || undefined,
      page: params.page,
      limit: params.limit,
    })}`,
    { headers: { Accept: "application/json" } }
  );
  const { data, total } = await unwrap<AeSignal[]>(res);
  return { items: data, total };
}

export interface CreateSignalPayload {
  drug: string;
  event: string;
  severity: AeSeverity;
  status: AeStatus;
  notes: string | null;
}

export async function createSignal(
  payload: CreateSignalPayload
): Promise<AeSignal> {
  const res = await fetch(`/api/ae-signals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const { data } = await unwrap<AeSignal>(res);
  return data;
}

export async function updateSignal(
  id: string,
  patch: Partial<CreateSignalPayload>
): Promise<AeSignal> {
  const res = await fetch(`/api/ae-signals/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const { data } = await unwrap<AeSignal>(res);
  return data;
}
