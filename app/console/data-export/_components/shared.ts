import type {
  ExportFormat,
  ExportScope,
  ExportStatus,
} from "@/lib/dataexport/schemas";

// Shared labels + formatting for the data export center UI.

export const SCOPE_LABELS: Record<ExportScope, string> = {
  claims: "Claims",
  verifications: "Verifications",
  evidence: "Evidence",
  documents: "Documents",
  references: "References",
};

export const SCOPE_DESCRIPTIONS: Record<ExportScope, string> = {
  claims: "Every claim submitted in this workspace.",
  verifications: "Verification results with trust scores and matched sources.",
  evidence: "Evidence items linked to your projects.",
  documents: "Uploaded document metadata (not the file contents).",
  references: "Bibliographic references from your libraries.",
};

export const FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: "CSV",
  json: "JSON",
};

// Tailwind classes for each export status badge.
export const STATUS_STYLES: Record<ExportStatus, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  processing: "bg-blue-50 text-blue-700 border-blue-200",
  complete: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-red-50 text-red-700 border-red-200",
};

export function statusStyle(status: string): string {
  return STATUS_STYLES[status as ExportStatus] ?? "bg-ink/5 text-ink/60 border-ink/15";
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
