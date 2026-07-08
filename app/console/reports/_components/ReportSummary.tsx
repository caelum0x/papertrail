import type { Report } from "@/lib/reports-exports/types";
import { TYPE_LABELS, formatDateTime } from "./shared";

interface ReportSummaryProps {
  report: Report;
}

// Read-only metadata grid for a saved report.
export function ReportSummary({ report }: ReportSummaryProps) {
  return (
    <dl className="mt-6 grid grid-cols-1 gap-4 rounded-lg border border-ink/15 bg-white p-4 sm:grid-cols-2">
      <div>
        <dt className="text-xs uppercase tracking-wide text-ink/40">Data</dt>
        <dd className="mt-1 text-sm text-ink/80">{TYPE_LABELS[report.type]}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-ink/40">
          Project scope
        </dt>
        <dd className="mt-1 text-sm text-ink/80">
          {report.project_id ? report.project_id : "All projects"}
        </dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-ink/40">
          Created by
        </dt>
        <dd className="mt-1 text-sm text-ink/80">
          {report.created_by_name ?? report.created_by_email ?? "—"}
        </dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-ink/40">Created</dt>
        <dd className="mt-1 text-sm text-ink/80">
          {formatDateTime(report.created_at)}
        </dd>
      </div>
    </dl>
  );
}
