import type { DataExport } from "@/lib/dataexport/types";
import { ExportHistoryRow } from "./ExportHistoryRow";

interface ExportHistoryTableProps {
  items: DataExport[];
}

// Table of past exports. Header + one ExportHistoryRow per record.
export function ExportHistoryTable({ items }: ExportHistoryTableProps) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/40">
          <th className="px-4 py-2 font-medium">Scope</th>
          <th className="px-4 py-2 font-medium">Format</th>
          <th className="px-4 py-2 font-medium">Rows</th>
          <th className="px-4 py-2 font-medium">Status</th>
          <th className="px-4 py-2 font-medium">Created by</th>
          <th className="px-4 py-2 font-medium">When</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <ExportHistoryRow key={item.id} item={item} />
        ))}
      </tbody>
    </table>
  );
}
