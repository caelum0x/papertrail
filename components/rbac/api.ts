// Client-side fetch helper for the RBAC & teams module. Reads the active org
// id from localStorage (set by the console layout's org switcher) and forwards
// it as the x-org-id header so withOrg scopes the request to the right tenant.

const ORG_STORAGE_KEY = "pt_active_org";

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: { total?: number; page?: number; limit?: number };
}

function orgHeaders(): Record<string, string> {
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

/* ------------------------------- Shared types ------------------------------ */

export interface CustomRoleDTO {
  id: string;
  orgId: string;
  name: string;
  permissions: string[];
  createdAt: string;
}

export interface TeamDTO {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
}

export interface TeamMemberDTO {
  id: string;
  orgId: string;
  teamId: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  createdAt: string;
}

export interface AssignableMemberDTO {
  userId: string;
  email: string;
  name: string | null;
}

export interface MatrixResourceDTO {
  resource: string;
  label: string;
  actions: string[];
}

export interface MatrixResponseDTO {
  actions: string[];
  resources: MatrixResourceDTO[];
  roles: { id: string; name: string; permissions: string[] }[];
}
