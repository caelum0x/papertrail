import Link from "next/link";
import type { SrProjectWithCounts } from "@/app/api/sr-projects/lib/types";
import { formatDate, statusLabel } from "./format";

// Table of systematic-review projects with their record/pending counts.

interface ReviewsTableProps {
  items: SrProjectWithCounts[];
}

export function ReviewsTable({ items }: ReviewsTableProps) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/40">
          <th className="px-4 py-2 font-medium">Name</th>
          <th className="px-4 py-2 font-medium">Status</th>
          <th className="px-4 py-2 font-medium">Records</th>
          <th className="px-4 py-2 font-medium">Pending</th>
          <th className="px-4 py-2 font-medium">Created</th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody>
        {items.map((p) => (
          <tr
            key={p.id}
            className="border-b border-ink/10 last:border-0 hover:bg-paper"
          >
            <td className="px-4 py-3 text-ink/80">
              <div className="font-medium">{p.name}</div>
              <div className="text-xs text-ink/40 line-clamp-1">
                {p.question}
              </div>
            </td>
            <td className="px-4 py-3 text-ink/60">{statusLabel(p.status)}</td>
            <td className="px-4 py-3 text-ink/60">{p.recordCount}</td>
            <td className="px-4 py-3 text-ink/60">{p.pendingCount}</td>
            <td className="px-4 py-3 text-ink/60">{formatDate(p.createdAt)}</td>
            <td className="px-4 py-3 text-right">
              <Link
                href={`/console/screening/${p.id}`}
                className="text-accent hover:underline"
              >
                Open
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
