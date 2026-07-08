import type { ImportBatch } from "@/lib/import/types";
import { ImportHistoryRow } from "./ImportHistoryRow";
import { EmptyState } from "./EmptyState";

// The import history table (batch list). Renders one ImportHistoryRow per batch,
// or an empty state when there are none.
export function ImportHistoryTable({ batches }: { batches: ImportBatch[] }) {
  if (batches.length === 0) {
    return (
      <EmptyState
        title="No imports yet."
        hint="Start your first import to bulk-load records."
        cta={{ href: "/console/import/new", label: "New import" }}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-ink/10 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-paper text-xs uppercase tracking-wide text-ink/40">
          <tr>
            <th className="px-3 py-2 font-medium">Target</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">Total</th>
            <th className="px-3 py-2 text-right font-medium">OK</th>
            <th className="px-3 py-2 text-right font-medium">Failed</th>
            <th className="px-3 py-2 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <ImportHistoryRow key={batch.id} batch={batch} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
