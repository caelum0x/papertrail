import type { ImportRow } from "@/lib/import/types";
import { RowStatusBadge } from "./ImportStatusBadge";
import { RowError } from "./RowError";
import { EmptyState } from "./EmptyState";

function preview(data: Record<string, string>): string {
  const parts = Object.entries(data)
    .filter(([, v]) => v && v.trim().length > 0)
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${v}`);
  const text = parts.join(" · ");
  return text.length > 140 ? `${text.slice(0, 140)}…` : text || "(empty row)";
}

// Detail-view table of staged rows with per-row status and error.
export function RowsTable({ rows }: { rows: ImportRow[] }) {
  if (rows.length === 0) {
    return <EmptyState title="No rows in this batch." />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-ink/10 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-paper text-xs uppercase tracking-wide text-ink/40">
          <tr>
            <th className="w-12 px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">Preview</th>
            <th className="w-28 px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Error</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-ink/10 align-top">
              <td className="px-3 py-2 tabular-nums text-ink/40">{row.rowIndex + 1}</td>
              <td className="px-3 py-2 text-ink/80">{preview(row.data)}</td>
              <td className="px-3 py-2">
                <RowStatusBadge status={row.status} />
              </td>
              <td className="px-3 py-2">
                <RowError error={row.error} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
