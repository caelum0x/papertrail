// Client-side fetch helpers for Saved views. Reads the active org id from
// localStorage (set by the console layout's org switcher) and forwards it as the
// x-org-id header so withOrg scopes each request. Shared by the console pages and
// by SavedViewBar embedded in other modules' list pages.

const ORG_STORAGE_KEY = "pt_active_org";

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: { total?: number; page?: number; limit?: number };
}

export type ViewResource =
  | "claims"
  | "references"
  | "documents"
  | "projects"
  | "reviews"
  | "reports"
  | "sources";

export const VIEW_RESOURCES: readonly ViewResource[] = [
  "claims",
  "references",
  "documents",
  "projects",
  "reviews",
  "reports",
  "sources",
];

// Human-friendly labels for each resource, used across the UI.
export const RESOURCE_LABELS: Record<ViewResource, string> = {
  claims: "Claims",
  references: "References",
  documents: "Documents",
  projects: "Projects",
  reviews: "Reviews",
  reports: "Reports",
  sources: "Sources",
};

export type SortDirection = "asc" | "desc";

export interface ViewFilter {
  field: string;
  operator: string;
  value: string;
}

export interface ViewSort {
  field: string;
  direction: SortDirection;
}

export interface ViewQuery {
  search?: string;
  filters: ViewFilter[];
  sort: ViewSort[];
}

export interface SavedViewDto {
  id: string;
  orgId: string;
  userId: string;
  name: string;
  resource: ViewResource;
  query: ViewQuery;
  shared: boolean;
  isOwner: boolean;
  ownerName: string | null;
  createdAt: string;
}

// Operators offered by the FilterEditor. Kept small and generic so a single
// editor works across every resource.
export const FILTER_OPERATORS: readonly { value: string; label: string }[] = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "gt", label: "greater than" },
  { value: "lt", label: "less than" },
  { value: "in", label: "is any of" },
];

export function operatorLabel(value: string): string {
  return FILTER_OPERATORS.find((o) => o.value === value)?.label ?? value;
}

export function emptyQuery(): ViewQuery {
  return { search: "", filters: [], sort: [] };
}

export function isViewResource(value: string | null): value is ViewResource {
  return value !== null && (VIEW_RESOURCES as readonly string[]).includes(value);
}

export function orgHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const orgId = window.localStorage.getItem(ORG_STORAGE_KEY);
  return orgId ? { "x-org-id": orgId } : {};
}

export async function apiGet<T>(path: string): Promise<ApiEnvelope<T>> {
  const res = await fetch(path, {
    headers: { ...orgHeaders() },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!body) {
    return { success: false, data: null, error: `Request failed (${res.status}).` };
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
    return { success: false, data: null, error: `Request failed (${res.status}).` };
  }
  return body;
}

// --- Typed convenience wrappers used across the module ---------------------

export function fetchViews(params?: {
  page?: number;
  limit?: number;
  resource?: ViewResource;
}): Promise<ApiEnvelope<SavedViewDto[]>> {
  const q = new URLSearchParams();
  if (params?.page) q.set("page", String(params.page));
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.resource) q.set("resource", params.resource);
  const qs = q.toString();
  return apiGet<SavedViewDto[]>(`/api/views${qs ? `?${qs}` : ""}`);
}

export function fetchView(id: string): Promise<ApiEnvelope<SavedViewDto>> {
  return apiGet<SavedViewDto>(`/api/views/${id}`);
}

export function createView(input: {
  name: string;
  resource: ViewResource;
  query: ViewQuery;
  shared?: boolean;
}): Promise<ApiEnvelope<SavedViewDto>> {
  return apiSend<SavedViewDto>("/api/views", "POST", input);
}

export function updateView(
  id: string,
  input: { name?: string; query?: ViewQuery; shared?: boolean }
): Promise<ApiEnvelope<SavedViewDto>> {
  return apiSend<SavedViewDto>(`/api/views/${id}`, "PATCH", input);
}

export function deleteView(
  id: string
): Promise<ApiEnvelope<{ id: string; deleted: boolean }>> {
  return apiSend<{ id: string; deleted: boolean }>(`/api/views/${id}`, "DELETE");
}
