import type { ExportJob } from "@/lib/reports-exports/types";
import { TYPE_LABELS, formatDateTime } from "./shared";

interface ExportJobsTableProps {
  jobs: ExportJob[];
}

// Recent export-job history table.
export function ExportJobsTable({ jobs }: ExportJobsTableProps) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/40">
          <th className="px-4 py-2 font-medium">Data</th>
          <th className="px-4 py-2 font-medium">Format</th>
          <th className="px-4 py-2 font-medium">Rows</th>
          <th className="px-4 py-2 font-medium">Status</th>
          <th className="px-4 py-2 font-medium">When</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((j) => (
          <tr key={j.id} className="border-b border-ink/10 last:border-0">
            <td className="px-4 py-3 text-ink/80">
              {TYPE_LABELS[j.type] ?? j.type}
            </td>
            <td className="px-4 py-3 text-ink/60 uppercase">
              {j.params?.format ?? "—"}
            </td>
            <td className="px-4 py-3 text-ink/60">
              {j.params?.row_count ?? "—"}
            </td>
            <td className="px-4 py-3 text-ink/60 capitalize">{j.status}</td>
            <td className="px-4 py-3 text-ink/60">
              {formatDateTime(j.created_at)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
