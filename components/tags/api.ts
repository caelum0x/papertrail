// Client-side fetch helpers for Tags & taxonomy. Reads the active org id from
// localStorage (set by the console layout's org switcher) and forwards it as the
// x-org-id header so withOrg scopes each request. Shared by the settings pages
// and by TagPicker/TagBadge embedded in other modules.

const ORG_STORAGE_KEY = "pt_active_org";

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: { total?: number; page?: number; limit?: number };
}

export interface TagDto {
  id: string;
  orgId: string;
  name: string;
  color: string;
  parentId: string | null;
  usageCount?: number;
  createdAt: string;
}

export interface TagTreeNodeDto extends TagDto {
  children: TagTreeNodeDto[];
}

export interface TaggingDto {
  id: string;
  orgId: string;
  tagId: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

export interface TagUsageGroupDto {
  entityType: string;
  count: number;
}

export interface TagUsageDto {
  total: number;
  groups: TagUsageGroupDto[];
  taggings: TaggingDto[];
}

export type TaggableEntityType =
  | "claim"
  | "reference"
  | "document"
  | "project"
  | "review"
  | "report";

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

export function fetchTags(params?: {
  page?: number;
  limit?: number;
  parentId?: string;
  search?: string;
}): Promise<ApiEnvelope<TagDto[]>> {
  const q = new URLSearchParams();
  if (params?.page) q.set("page", String(params.page));
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.parentId) q.set("parentId", params.parentId);
  if (params?.search) q.set("search", params.search);
  const qs = q.toString();
  return apiGet<TagDto[]>(`/api/tags${qs ? `?${qs}` : ""}`);
}

export function fetchTagTree(): Promise<ApiEnvelope<TagTreeNodeDto[]>> {
  return apiGet<TagTreeNodeDto[]>("/api/tags/tree");
}

export function fetchTag(id: string): Promise<ApiEnvelope<TagDto>> {
  return apiGet<TagDto>(`/api/tags/${id}`);
}

export function fetchTagUsage(
  id: string,
  limit = 25
): Promise<ApiEnvelope<TagUsageDto>> {
  return apiGet<TagUsageDto>(`/api/tags/${id}/usage?limit=${limit}`);
}

export function createTag(input: {
  name: string;
  color?: string;
  parentId?: string | null;
}): Promise<ApiEnvelope<TagDto>> {
  return apiSend<TagDto>("/api/tags", "POST", input);
}

export function updateTag(
  id: string,
  input: { name?: string; color?: string; parentId?: string | null }
): Promise<ApiEnvelope<TagDto>> {
  return apiSend<TagDto>(`/api/tags/${id}`, "PATCH", input);
}

export function deleteTag(
  id: string
): Promise<ApiEnvelope<{ id: string; deleted: boolean }>> {
  return apiSend<{ id: string; deleted: boolean }>(`/api/tags/${id}`, "DELETE");
}

export function fetchEntityTags(
  entityType: TaggableEntityType,
  entityId: string
): Promise<ApiEnvelope<TagDto[]>> {
  const q = new URLSearchParams({ entity_type: entityType, entity_id: entityId });
  return apiGet<TagDto[]>(`/api/taggings?${q.toString()}`);
}

export function attachTag(input: {
  tagId: string;
  entityType: TaggableEntityType;
  entityId: string;
}): Promise<ApiEnvelope<TaggingDto>> {
  return apiSend<TaggingDto>("/api/taggings", "POST", input);
}

export function detachTag(input: {
  tagId: string;
  entityType: TaggableEntityType;
  entityId: string;
}): Promise<ApiEnvelope<{ detached: boolean }>> {
  const q = new URLSearchParams({
    tag_id: input.tagId,
    entity_type: input.entityType,
    entity_id: input.entityId,
  });
  return apiSend<{ detached: boolean }>(`/api/taggings?${q.toString()}`, "DELETE");
}
