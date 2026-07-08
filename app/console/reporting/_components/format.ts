import type { ReportType, RunStatus } from "@/lib/reporting/types";

// Shared presentation helpers for the reporting module.

const TYPE_LABELS: Record<ReportType, string> = {
  summary: "Summary",
  claims: "Claims",
  reviews: "Reviews",
  documents: "Documents",
};

export function typeLabel(type: ReportType): string {
  return TYPE_LABELS[type] ?? type;
}

const STATUS_STYLES: Record<RunStatus, string> = {
  pending: "bg-ink/10 text-ink/60",
  running: "bg-amber-100 text-amber-800",
  complete: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
};

export function statusStyle(status: RunStatus): string {
  return STATUS_STYLES[status] ?? "bg-ink/10 text-ink/60";
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
