// Shared types for the public API platform module (webhooks + deliveries).
// Every entity is org-scoped. These are the JSON shapes returned by the
// module's /api/webhooks routes and consumed by the developer portal pages.

export type WebhookStatus = "active" | "disabled";
export type WebhookDeliveryStatus = "success" | "failed" | "skipped";

// The set of events an org can subscribe a webhook to. Kept small and explicit
// so the portal can render checkboxes and dispatch can validate event names.
export const WEBHOOK_EVENTS = [
  "verification.completed",
  "verification.flagged",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

// A webhook as shown in listings and detail views. The `secret` is never
// returned in full — only a short non-secret hint for recognition.
export interface WebhookSummary {
  id: string;
  url: string;
  events: string[];
  status: WebhookStatus;
  secretHint: string | null;
  createdAt: string;
}

// Returned exactly once, at creation time, with the full signing secret so the
// caller can configure signature verification on their receiver.
export interface WebhookCreated extends WebhookSummary {
  secret: string;
}

// One recorded delivery attempt for a webhook.
export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  status: WebhookDeliveryStatus;
  responseCode: number | null;
  createdAt: string;
}

// Aggregate result of dispatching one event across an org's matching webhooks.
export interface DispatchResult {
  event: string;
  attempted: number;
  delivered: number;
  failed: number;
}
