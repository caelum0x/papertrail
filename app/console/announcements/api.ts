// Client-side fetch helpers for the Announcements, releases & changelog console
// pages. Reads the active org id from localStorage (set by the console layout's
// org switcher) and forwards it as the x-org-id header so withOrg scopes each
// request. DTOs mirror the domain models in lib/announcements/types.ts.

const ORG_STORAGE_KEY = "pt_active_org";

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: { total?: number; page?: number; limit?: number };
}

export type AnnouncementKind =
  | "general"
  | "feature"
  | "maintenance"
  | "policy"
  | "security";

export type AnnouncementAudience = "all" | "admins" | "owners";

export interface AnnouncementDto {
  id: string;
  orgId: string;
  title: string;
  body: string;
  kind: AnnouncementKind;
  audience: AnnouncementAudience;
  publishedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  authorName?: string | null;
  authorEmail?: string | null;
  read?: boolean;
}

export interface ReleaseDto {
  id: string;
  orgId: string;
  version: string;
  notes: string;
  releasedAt: string;
  createdAt: string;
}

export interface CreateAnnouncementPayload {
  title: string;
  body: string;
  kind?: AnnouncementKind;
  audience?: AnnouncementAudience;
  publish?: boolean;
}

export interface UpdateAnnouncementPayload {
  title?: string;
  body?: string;
  kind?: AnnouncementKind;
  audience?: AnnouncementAudience;
}

export interface CreateReleasePayload {
  version: string;
  notes?: string;
  releasedAt?: string;
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

// --- Small presentational constants shared across announcement components ----

export const KIND_LABELS: Record<AnnouncementKind, string> = {
  general: "General",
  feature: "New feature",
  maintenance: "Maintenance",
  policy: "Policy",
  security: "Security",
};

// Tailwind badge classes per kind (border + tint), kept within the app palette.
export const KIND_BADGE_CLASSES: Record<AnnouncementKind, string> = {
  general: "border-ink/10 text-ink/60",
  feature: "border-accent/30 text-accent",
  maintenance: "border-amber-300 text-amber-700",
  policy: "border-ink/20 text-ink/80",
  security: "border-red-300 text-red-700",
};

export const AUDIENCE_LABELS: Record<AnnouncementAudience, string> = {
  all: "Everyone",
  admins: "Admins",
  owners: "Owners",
};

export const ANNOUNCEMENT_KIND_OPTIONS: { value: AnnouncementKind; label: string }[] =
  [
    { value: "general", label: "General" },
    { value: "feature", label: "New feature" },
    { value: "maintenance", label: "Maintenance" },
    { value: "policy", label: "Policy" },
    { value: "security", label: "Security" },
  ];

export const ANNOUNCEMENT_AUDIENCE_OPTIONS: {
  value: AnnouncementAudience;
  label: string;
}[] = [
  { value: "all", label: "Everyone" },
  { value: "admins", label: "Admins" },
  { value: "owners", label: "Owners" },
];

// Formats an ISO timestamp as a short human date; returns "—" for null.
export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
