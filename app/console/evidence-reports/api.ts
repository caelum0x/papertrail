// Client-side fetch helpers for the saved Evidence Reports console pages. Reads
// the active org id from localStorage (set by the console layout's org switcher)
// and forwards it as the x-org-id header so withOrg scopes each request. DTOs
// mirror EvidenceReportRecord in lib/evidenceReports/types.ts. No science is
// recomputed here — the workbench sends the already-computed composite object.

const ORG_STORAGE_KEY = "pt_active_org";

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: { total?: number; page?: number; limit?: number };
}

// Mirror of EvidenceReportRecord (camelCase) returned by the API.
export interface SavedEvidenceReportDto {
  id: string;
  orgId: string;
  projectId: string | null;
  createdBy: string | null;
  claim: string;
  verdict: string | null;
  certainty: string | null;
  pooled: Record<string, unknown> | null;
  report: Record<string, unknown>;
  createdAt: string;
}

// Body accepted by POST /api/evidence-reports (createEvidenceReportSchema).
export interface SaveEvidenceReportPayload {
  claim: string;
  report: Record<string, unknown>;
  verdict?: string;
  certainty?: string;
  pooled?: Record<string, unknown>;
  projectId?: string;
}

export function orgHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const orgId = window.localStorage.getItem(ORG_STORAGE_KEY);
  return orgId ? { "x-org-id": orgId } : {};
}

// Maps an HTTP status to a user-facing message when the JSON envelope carries no
// error text (or the response wasn't JSON at all).
function statusMessage(status: number): string {
  if (status === 401) return "Please sign in to save or view reports.";
  if (status === 403) return "You don't have access to this organization.";
  if (status === 404) return "That report no longer exists.";
  return `Request failed (${status}).`;
}

export async function apiGet<T>(path: string): Promise<ApiEnvelope<T>> {
  const res = await fetch(path, { headers: { ...orgHeaders() }, cache: "no-store" });
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!body) {
    return { success: false, data: null, error: statusMessage(res.status) };
  }
  if (!res.ok && !body.error) {
    return { ...body, success: false, error: statusMessage(res.status) };
  }
  return body;
}

export async function apiSend<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  payload?: unknown
): Promise<ApiEnvelope<T>> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", ...orgHeaders() },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!body) {
    return { success: false, data: null, error: statusMessage(res.status) };
  }
  if (!res.ok && !body.error) {
    return { ...body, success: false, error: statusMessage(res.status) };
  }
  return body;
}

// Formats an ISO timestamp as a short human date-time; returns "—" for null.
export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
