import Link from "next/link";
import { formatTime, formatPercent, type EvalRun } from "../lib";
import { StatusBadge } from "./Badges";

// Cross-set recent runs table shown on the evaluation index.

interface RecentRunsTableProps {
  runs: EvalRun[];
}

export function RecentRunsTable({ runs }: RecentRunsTableProps) {
  return (
    <div className="mt-6">
      <h2 className="text-sm font-medium text-ink/80">Recent runs</h2>
      <div className="mt-3 overflow-hidden rounded-lg border border-ink/15 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs text-ink/40">
              <th className="px-4 py-2 font-medium">Run</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Accuracy</th>
              <th className="px-4 py-2 font-medium">Span grounding</th>
              <th className="px-4 py-2 font-medium">Cases</th>
              <th className="px-4 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-b border-ink/10 last:border-0">
                <td className="px-4 py-2">
                  <Link
                    href={`/console/evaluation/runs/${r.id}`}
                    className="font-mono text-xs text-accent hover:underline"
                  >
                    {r.id.slice(0, 8)}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-2 text-ink/60">
                  {formatPercent(r.accuracy)}
                </td>
                <td className="px-4 py-2 text-ink/60">
                  {formatPercent(r.spanGroundingRate)}
                </td>
                <td className="px-4 py-2 text-ink/60">
                  {r.summary?.totalCases ?? 0}
                </td>
                <td className="px-4 py-2 text-xs text-ink/50">
                  {formatTime(r.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
