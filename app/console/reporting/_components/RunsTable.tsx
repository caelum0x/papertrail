"use client";

import type { ReportRun } from "@/lib/reporting/types";
import { StatusBadge } from "./StatusBadge";
import { formatDate } from "./format";

interface RunsTableProps {
  runs: ReportRun[];
  selectedId: string | null;
  onSelect: (run: ReportRun) => void;
}

// Table of a definition's runs. Selecting a row surfaces its composed result in
// the adjacent RunDetail panel.
export function RunsTable({ runs, selectedId, onSelect }: RunsTableProps) {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-xs uppercase tracking-wide text-ink/40">
          <th className="px-4 py-2 font-medium">Status</th>
          <th className="px-4 py-2 font-medium">Format</th>
          <th className="px-4 py-2 font-medium">Created</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr
            key={run.id}
            onClick={() => onSelect(run)}
            className={`cursor-pointer border-t border-ink/10 hover:bg-paper ${
              selectedId === run.id ? "bg-paper" : ""
            }`}
          >
            <td className="px-4 py-3">
              <StatusBadge status={run.status} />
            </td>
            <td className="px-4 py-3 uppercase text-ink/60">{run.format}</td>
            <td className="px-4 py-3 text-ink/50">{formatDate(run.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
