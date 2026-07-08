import Link from "next/link";
import type { DataExport } from "@/lib/dataexport/types";
import { StatusBadge } from "./StatusBadge";
import { FORMAT_LABELS, SCOPE_LABELS, formatDateTime } from "./shared";

interface ExportHistoryRowProps {
  item: DataExport;
}

// One row in the export history table. The whole row links through to the export
// detail page.
export function ExportHistoryRow({ item }: ExportHistoryRowProps) {
  return (
    <tr className="border-b border-ink/10 last:border-0 hover:bg-paper">
      <td className="px-4 py-3">
        <Link
          href={`/console/data-export/${item.id}`}
          className="font-medium text-ink/80 hover:text-accent hover:underline"
        >
          {SCOPE_LABELS[item.scope] ?? item.scope}
        </Link>
      </td>
      <td className="px-4 py-3 text-ink/60">
        {FORMAT_LABELS[item.format] ?? item.format.toUpperCase()}
      </td>
      <td className="px-4 py-3 text-ink/60">{item.row_count}</td>
      <td className="px-4 py-3">
        <StatusBadge status={item.status} />
      </td>
      <td className="px-4 py-3 text-ink/50">
        {item.created_by_name ?? item.created_by_email ?? "—"}
      </td>
      <td className="px-4 py-3 text-ink/50">
        {formatDateTime(item.created_at)}
      </td>
    </tr>
  );
}
