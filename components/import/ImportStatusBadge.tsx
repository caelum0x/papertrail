import type { ImportBatchStatus, ImportRowStatus } from "@/lib/import/types";

// Small colored pill for batch/row status. Purely presentational.

const BATCH_STYLES: Record<ImportBatchStatus, string> = {
  pending: "bg-paper text-ink/60 border-ink/10",
  committing: "bg-amber-50 text-amber-700 border-amber-200",
  committed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-red-50 text-red-700 border-red-200",
};

const ROW_STYLES: Record<ImportRowStatus, string> = {
  pending: "bg-paper text-ink/60 border-ink/10",
  succeeded: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  skipped: "bg-paper text-ink/40 border-ink/10",
};

export function BatchStatusBadge({ status }: { status: ImportBatchStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${BATCH_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

export function RowStatusBadge({ status }: { status: ImportRowStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${ROW_STYLES[status]}`}
    >
      {status}
    </span>
  );
}
