import type {
  MonitorSourceType,
  MonitorFrequency,
  MonitorHitStatus,
  AeSeverity,
  AeStatus,
} from "@/lib/monitoring/types";

// Display labels and badge styling for monitoring enums. Kept in one place so
// the list pages, triage board, and signal board stay visually consistent.

export const SOURCE_TYPE_LABELS: Record<MonitorSourceType, string> = {
  pubmed: "PubMed",
  clinicaltrials: "ClinicalTrials.gov",
};

export const FREQUENCY_LABELS: Record<MonitorFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

export const FREQUENCY_OPTIONS: { value: MonitorFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

export const HIT_STATUS_LABELS: Record<MonitorHitStatus, string> = {
  new: "New",
  relevant: "Relevant",
  dismissed: "Dismissed",
  escalated: "Escalated",
};

export const HIT_STATUS_STYLES: Record<MonitorHitStatus, string> = {
  new: "bg-blue-50 text-blue-700 border-blue-200",
  relevant: "bg-green-50 text-green-700 border-green-200",
  dismissed: "bg-ink/5 text-ink/50 border-ink/10",
  escalated: "bg-amber-50 text-amber-700 border-amber-200",
};

export const SEVERITY_LABELS: Record<AeSeverity, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  critical: "Critical",
};

export const SEVERITY_STYLES: Record<AeSeverity, string> = {
  low: "bg-ink/5 text-ink/60 border-ink/10",
  moderate: "bg-blue-50 text-blue-700 border-blue-200",
  high: "bg-amber-50 text-amber-700 border-amber-200",
  critical: "bg-red-50 text-red-700 border-red-200",
};

export const SEVERITY_OPTIONS: { value: AeSeverity; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "moderate", label: "Moderate" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

export const AE_STATUS_LABELS: Record<AeStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  confirmed: "Confirmed",
  refuted: "Refuted",
  closed: "Closed",
};

export const AE_STATUS_STYLES: Record<AeStatus, string> = {
  open: "bg-blue-50 text-blue-700 border-blue-200",
  investigating: "bg-amber-50 text-amber-700 border-amber-200",
  confirmed: "bg-red-50 text-red-700 border-red-200",
  refuted: "bg-ink/5 text-ink/50 border-ink/10",
  closed: "bg-green-50 text-green-700 border-green-200",
};

export const AE_STATUS_OPTIONS: { value: AeStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "investigating", label: "Investigating" },
  { value: "confirmed", label: "Confirmed" },
  { value: "refuted", label: "Refuted" },
  { value: "closed", label: "Closed" },
];
