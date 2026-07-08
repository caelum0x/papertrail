// Shared types for the audit module presentational components.

export interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  userName: string | null;
  userEmail: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AuditFilterOptions {
  actions: string[];
  entityTypes: string[];
  users: { id: string; name: string | null; email: string }[];
}

export interface AuditListResponse {
  entries: AuditLogEntry[];
  filters: AuditFilterOptions;
}

export const PAGE_SIZE = 25;

export function buildAuditQuery(
  page: number,
  action: string,
  entityType: string,
  userId: string
): string {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", String(PAGE_SIZE));
  if (action) params.set("action", action);
  if (entityType) params.set("entityType", entityType);
  if (userId) params.set("userId", userId);
  return params.toString();
}
