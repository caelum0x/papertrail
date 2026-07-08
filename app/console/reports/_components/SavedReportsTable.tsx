import Link from "next/link";
import type { Report } from "@/lib/reports-exports/types";
import { TYPE_LABELS, formatDateTime } from "./shared";

interface ReportRowProps {
  report: Report;
  canEdit: boolean;
  onDelete: (id: string) => void;
}

function ReportRow({ report, canEdit, onDelete }: ReportRowProps) {
  return (
    <tr className="border-b border-ink/10 last:border-0 hover:bg-paper">
      <td className="px-4 py-3 text-ink/80">
        <Link
          href={`/console/reports/${report.id}`}
          className="text-accent hover:underline"
        >
          {report.name}
        </Link>
      </td>
      <td className="px-4 py-3 text-ink/60">{TYPE_LABELS[report.type]}</td>
      <td className="px-4 py-3 text-ink/60">
        {report.created_by_name ?? report.created_by_email ?? "—"}
      </td>
      <td className="px-4 py-3 text-ink/60">
        {formatDateTime(report.created_at)}
      </td>
      <td className="px-4 py-3 text-right">
        {canEdit ? (
          <button
            onClick={() => onDelete(report.id)}
            className="text-ink/40 hover:text-red-700"
          >
            Delete
          </button>
        ) : null}
      </td>
    </tr>
  );
}

interface SavedReportsTableProps {
  reports: Report[];
  canEdit: boolean;
  onDelete: (id: string) => void;
}

export function SavedReportsTable({
  reports,
  canEdit,
  onDelete,
}: SavedReportsTableProps) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/40">
          <th className="px-4 py-2 font-medium">Name</th>
          <th className="px-4 py-2 font-medium">Data</th>
          <th className="px-4 py-2 font-medium">Created by</th>
          <th className="px-4 py-2 font-medium">Created</th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody>
        {reports.map((r) => (
          <ReportRow
            key={r.id}
            report={r}
            canEdit={canEdit}
            onDelete={onDelete}
          />
        ))}
      </tbody>
    </table>
  );
}
