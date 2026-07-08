import Link from "next/link";
import type { RunSummary } from "@/lib/workflows/repository";
import { RunStatus } from "./RunStatus";
import { formatDateTime } from "./format";

// Full runs table for the workflow runs index (all workflows).

interface RunsTableProps {
  items: RunSummary[];
}

export function RunsTable({ items }: RunsTableProps) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/40">
          <th className="px-4 py-2 font-medium">Workflow</th>
          <th className="px-4 py-2 font-medium">Status</th>
          <th className="px-4 py-2 font-medium">Started</th>
          <th className="px-4 py-2 font-medium">Finished</th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody>
        {items.map((r) => (
          <tr
            key={r.id}
            className="border-b border-ink/10 last:border-0 hover:bg-paper"
          >
            <td className="px-4 py-3 text-ink/80">{r.workflowKey ?? "—"}</td>
            <td className="px-4 py-3">
              <RunStatus status={r.status} />
            </td>
            <td className="px-4 py-3 text-ink/60">
              {formatDateTime(r.startedAt)}
            </td>
            <td className="px-4 py-3 text-ink/60">
              {formatDateTime(r.finishedAt)}
            </td>
            <td className="px-4 py-3 text-right">
              <Link
                href={`/console/workflows/runs/${r.id}`}
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
