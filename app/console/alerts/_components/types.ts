import type { AlertAssessOutcome } from "@/lib/alerts/schemas";

// The API returns the discriminated engine outcome inside the standard envelope's
// `data`. Re-exported here so the page and its components share one source of truth.
export type AlertsAssessResponse = AlertAssessOutcome;
