import Link from "next/link";
import type { RunSummary } from "@/lib/workflows/repository";
import { RunStatus } from "./RunStatus";
import { formatDateTime } from "./format";

// Compact list of the most recent runs for a single workflow (detail page).

interface RecentRunsTableProps {
  runs: RunSummary[];
}

export function RecentRunsTable({ runs }: RecentRunsTableProps) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white">
      <div className="border-b border-ink/10 px-6 py-3">
        <h2 className="text-sm font-medium text-ink/70">Recent runs</h2>
      </div>
      {runs.length === 0 ? (
        <div className="p-6 text-center text-sm text-ink/40">
          No runs yet for this workflow.
        </div>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {runs.map((r) => (
              <tr
                key={r.id}
                className="border-b border-ink/10 last:border-0 hover:bg-paper"
              >
                <td className="px-6 py-3">
                  <RunStatus status={r.status} />
                </td>
                <td className="px-6 py-3 text-ink/60">
                  {formatDateTime(r.createdAt)}
                </td>
                <td className="px-6 py-3 text-right">
                  <Link
                    href={`/console/workflows/runs/${r.id}`}
                    className="text-accent hover:underline"
                  >
                    View trace
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
