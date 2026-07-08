// Client-side fetch helpers for the Help center / support / feedback console
// pages. Reads the active org id from localStorage (set by the console layout's
// org switcher) and forwards it as the x-org-id header so withOrg scopes each
// request. DTOs mirror the domain models in lib/help/types.ts.

const ORG_STORAGE_KEY = "pt_active_org";

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: { total?: number; page?: number; limit?: number };
}

export type TicketStatus = "open" | "pending" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type FeedbackKind = "bug" | "idea" | "praise" | "other";

export interface HelpArticleDto {
  id: string;
  orgId: string;
  slug: string;
  title: string;
  body: string;
  category: string;
  createdAt: string;
}

export interface HelpCategoryDto {
  category: string;
  count: number;
}

export interface SupportTicketDto {
  id: string;
  orgId: string;
  userId: string;
  subject: string;
  body: string;
  status: TicketStatus;
  priority: TicketPriority;
  createdAt: string;
  authorName?: string | null;
  authorEmail?: string | null;
  messageCount?: number;
}

export interface TicketMessageDto {
  id: string;
  orgId: string;
  ticketId: string;
  authorId: string;
  body: string;
  createdAt: string;
  authorName?: string | null;
  authorEmail?: string | null;
}

export interface TicketDetailDto {
  ticket: SupportTicketDto;
  messages: TicketMessageDto[];
}

export interface FeedbackDto {
  id: string;
  orgId: string;
  userId: string;
  kind: FeedbackKind;
  message: string;
  createdAt: string;
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

// --- Small presentational constants shared across help components ------------

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  pending: "Pending",
  resolved: "Resolved",
  closed: "Closed",
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const FEEDBACK_LABELS: Record<FeedbackKind, string> = {
  bug: "Bug report",
  idea: "Feature idea",
  praise: "Praise",
  other: "Other",
};
