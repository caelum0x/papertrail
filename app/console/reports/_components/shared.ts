import type { ReportType } from "@/lib/reports-exports/schemas";

// Shared labels + formatting for the reports & exports module UI.

export const TYPE_LABELS: Record<ReportType, string> = {
  verifications: "Verifications",
  claims: "Claims",
  evidence: "Evidence",
};

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
