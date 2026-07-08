"use client";

// Client-side fetch helpers and view models for the collaboration module.
// Mirrors the notifications apiClient: sends the active org id in x-org-id and
// unwraps the { success, data, error, meta } envelope. View models are the
// camelCase shapes returned by the collaboration API.

const ORG_STORAGE_KEY = "pt_active_org";

function activeOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ORG_STORAGE_KEY);
}

export interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: { total?: number; page?: number; limit?: number };
}

function orgHeaders(extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = {};
  const orgId = activeOrgId();
  if (orgId) headers["x-org-id"] = orgId;
  if (extra) {
    for (const [k, v] of Object.entries(extra as Record<string, string>)) {
      headers[k] = v;
    }
  }
  return headers;
}

export async function getJson<T>(url: string): Promise<Envelope<T>> {
  const res = await fetch(url, { headers: orgHeaders() });
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!body) {
    return { success: false, data: null, error: "Unexpected response." };
  }
  return body;
}

export async function sendJson<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  payload?: unknown
): Promise<Envelope<T>> {
  const res = await fetch(url, {
    method,
    headers: orgHeaders({ "Content-Type": "application/json" }),
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!body) {
    return { success: false, data: null, error: "Unexpected response." };
  }
  return body;
}

// ---------------------------------------------------------------------------
// View models
// ---------------------------------------------------------------------------

export type CollabEntityType =
  | "claim"
  | "document"
  | "verification"
  | "review";

export interface CommentView {
  id: string;
  orgId: string;
  entityType: string;
  entityId: string;
  parentId: string | null;
  authorId: string;
  authorName: string | null;
  authorEmail: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityView {
  id: string;
  orgId: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  verb: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

export function displayName(
  name: string | null,
  email: string | null
): string {
  if (name && name.trim()) return name;
  if (email) return email.split("@")[0];
  return "Unknown";
}

export function initials(name: string | null, email: string | null): string {
  const source = displayName(name, email);
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const VERB_LABELS: Record<string, string> = {
  commented: "commented on",
  replied: "replied on",
  annotated: "annotated",
};

export function labelForVerb(verb: string): string {
  return VERB_LABELS[verb] ?? verb;
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Split a comment body into text and @mention segments for highlighting.
export interface BodySegment {
  text: string;
  mention: boolean;
}

const MENTION_SPLIT_RE = /(@[a-zA-Z0-9._-]+)/g;

export function segmentBody(body: string): BodySegment[] {
  return body
    .split(MENTION_SPLIT_RE)
    .filter((s) => s.length > 0)
    .map((s) => ({ text: s, mention: s.startsWith("@") }));
}
