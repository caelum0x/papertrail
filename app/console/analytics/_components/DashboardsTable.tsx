import { formatDateTime, type Dashboard } from "../client";

interface DashboardsTableProps {
  dashboards: Dashboard[];
  onDelete: (id: string) => void;
}

// Table of saved analytics dashboards with a delete action per row.
export function DashboardsTable({ dashboards, onDelete }: DashboardsTableProps) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/40">
          <th className="px-4 py-2 font-medium">Name</th>
          <th className="px-4 py-2 font-medium">Cards</th>
          <th className="px-4 py-2 font-medium">Created by</th>
          <th className="px-4 py-2 font-medium">Created</th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody>
        {dashboards.map((d) => (
          <tr
            key={d.id}
            className="border-b border-ink/10 last:border-0 hover:bg-paper"
          >
            <td className="px-4 py-3 text-ink/80">{d.name}</td>
            <td className="px-4 py-3 text-ink/60">{d.config.cards.length}</td>
            <td className="px-4 py-3 text-ink/60">
              {d.created_by_name ?? d.created_by_email ?? "—"}
            </td>
            <td className="px-4 py-3 text-ink/60">
              {formatDateTime(d.created_at)}
            </td>
            <td className="px-4 py-3 text-right">
              <button
                onClick={() => onDelete(d.id)}
                className="text-ink/40 hover:text-red-700"
              >
                Delete
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
