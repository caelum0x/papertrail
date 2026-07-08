// Shared types for the Pharmacovigilance & literature monitoring module.
// A monitor is a saved, scheduled query over the safety literature; a hit is a
// source it surfaced; an AE signal is a triaged drug/event pair under review.

export const MONITOR_SOURCE_TYPES = ["pubmed", "clinicaltrials"] as const;
export type MonitorSourceType = (typeof MONITOR_SOURCE_TYPES)[number];

export const MONITOR_FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export type MonitorFrequency = (typeof MONITOR_FREQUENCIES)[number];

export const MONITOR_HIT_STATUSES = [
  "new",
  "relevant",
  "dismissed",
  "escalated",
] as const;
export type MonitorHitStatus = (typeof MONITOR_HIT_STATUSES)[number];

export const AE_SEVERITIES = ["low", "moderate", "high", "critical"] as const;
export type AeSeverity = (typeof AE_SEVERITIES)[number];

export const AE_STATUSES = [
  "open",
  "investigating",
  "confirmed",
  "refuted",
  "closed",
] as const;
export type AeStatus = (typeof AE_STATUSES)[number];

export interface Monitor {
  id: string;
  org_id: string;
  project_id: string | null;
  name: string;
  query: string;
  sources: MonitorSourceType[];
  frequency: MonitorFrequency;
  enabled: boolean;
  last_run_at: string | null;
  created_at: string;
}

export interface MonitorHit {
  id: string;
  org_id: string;
  monitor_id: string;
  source_type: MonitorSourceType;
  external_id: string;
  title: string | null;
  url: string | null;
  matched_at: string;
  status: MonitorHitStatus;
  created_at: string;
}

export interface AeSignal {
  id: string;
  org_id: string;
  drug: string;
  event: string;
  severity: AeSeverity;
  status: AeStatus;
  notes: string | null;
  created_at: string;
}
