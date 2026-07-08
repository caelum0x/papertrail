// Shared types for the Integrations module (connectors + event log). Every
// entity is org-scoped. These are the JSON shapes returned by the module's
// /api/integrations routes and consumed by the console integrations pages.

export type IntegrationStatus = "active" | "disabled";

// Direction of an integration event relative to PaperTrail.
export type EventDirection = "outbound" | "inbound";

// Outcome of a recorded integration event.
export type EventStatus = "success" | "failed" | "skipped";

// A connector as shown in listings and detail views. `config` is redacted for
// list responses (secrets masked) — see redactConfig in the registry.
export interface Integration {
  id: string;
  provider: string;
  name: string;
  config: Record<string, unknown>;
  status: IntegrationStatus;
  createdAt: string;
}

// One recorded inbound/outbound event for a connector.
export interface IntegrationEvent {
  id: string;
  integrationId: string;
  direction: EventDirection;
  event: string;
  payload: Record<string, unknown>;
  status: EventStatus;
  createdAt: string;
}

// Result of exercising a connector via POST /api/integrations/[id]/test.
export interface IntegrationTestResult {
  ok: boolean;
  // Human-readable detail (e.g. "posted to Slack", "email not configured").
  detail: string;
  // HTTP status code when a real external call was made, else null.
  responseCode: number | null;
}
