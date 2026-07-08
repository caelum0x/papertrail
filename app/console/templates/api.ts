// Client-side fetch helpers for the Templates console pages. Reads the active
// org id from localStorage (set by the console layout's org switcher) and
// forwards it as the x-org-id header so withOrg scopes each request.

const ORG_STORAGE_KEY = "pt_active_org";

export const TEMPLATE_KINDS = [
  "claim",
  "report",
  "verification",
  "document",
] as const;

export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const TEMPLATE_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "boolean",
  "select",
] as const;

export type TemplateFieldType = (typeof TEMPLATE_FIELD_TYPES)[number];

export interface TemplateField {
  key: string;
  label: string;
  type: TemplateFieldType;
  required: boolean;
  placeholder?: string;
  options?: string[];
}

export interface TemplateBody {
  fields: TemplateField[];
  content: string;
}

export interface TemplateDto {
  id: string;
  org_id: string;
  kind: TemplateKind;
  name: string;
  description: string | null;
  category: string | null;
  body: TemplateBody;
  created_by: string | null;
  created_at: string;
  created_by_name: string | null;
  created_by_email: string | null;
}

export interface CategoryStat {
  category: string;
  count: number;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: { total?: number; page?: number; limit?: number };
}

export const KIND_LABELS: Record<TemplateKind, string> = {
  claim: "Claim",
  report: "Report",
  verification: "Verification",
  document: "Document",
};

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

export function emptyBody(): TemplateBody {
  return { fields: [], content: "" };
}
