import Link from "next/link";
import type { ImportBatch } from "@/lib/import/types";
import { BatchStatusBadge } from "./ImportStatusBadge";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

// One row in the import history table.
export function ImportHistoryRow({ batch }: { batch: ImportBatch }) {
  return (
    <tr className="border-t border-ink/10 hover:bg-paper">
      <td className="px-3 py-2">
        <Link
          href={`/console/import/${batch.id}`}
          className="font-medium text-accent hover:underline"
        >
          {batch.target}
        </Link>
        <div className="text-xs uppercase text-ink/40">{batch.format}</div>
      </td>
      <td className="px-3 py-2">
        <BatchStatusBadge status={batch.status} />
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-ink/80">{batch.total}</td>
      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
        {batch.succeeded}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-red-700">{batch.failed}</td>
      <td className="px-3 py-2 text-sm text-ink/60">{formatDate(batch.createdAt)}</td>
    </tr>
  );
}
