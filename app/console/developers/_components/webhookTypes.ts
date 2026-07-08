// Shared webhook view types and the toggleable event catalog.

export const AVAILABLE_EVENTS = [
  { value: "verification.completed", label: "Verification completed" },
  {
    value: "verification.flagged",
    label: "Verification flagged (discrepancy found)",
  },
] as const;

export interface WebhookSummary {
  id: string;
  url: string;
  events: string[];
  status: "active" | "disabled";
  secretHint: string | null;
  createdAt: string;
}

export interface WebhookCreated extends WebhookSummary {
  secret: string;
}
