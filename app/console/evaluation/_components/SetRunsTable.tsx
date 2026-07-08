import Link from "next/link";
import { formatTime, formatPercent, type EvalRun } from "../lib";
import { StatusBadge, AccuracyBadge } from "./Badges";

// Runs table scoped to a single eval set (detail page).

interface SetRunsTableProps {
  runs: EvalRun[];
}

export function SetRunsTable({ runs }: SetRunsTableProps) {
  return (
    <div className="mt-6">
      <h2 className="text-sm font-medium text-ink/80">Runs</h2>
      <div className="mt-3 overflow-hidden rounded-lg border border-ink/15 bg-white">
        {runs.length === 0 ? (
          <div className="p-8 text-center text-sm text-ink/40">
            No runs yet. Click &ldquo;Run eval set&rdquo; above.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs text-ink/40">
                <th className="px-4 py-2 font-medium">Run</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Accuracy</th>
                <th className="px-4 py-2 font-medium">Span grounding</th>
                <th className="px-4 py-2 font-medium">Passed</th>
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
                  <td className="px-4 py-2">
                    <AccuracyBadge
                      value={r.accuracy}
                      label={formatPercent(r.accuracy)}
                    />
                  </td>
                  <td className="px-4 py-2 text-ink/60">
                    {formatPercent(r.spanGroundingRate)}
                  </td>
                  <td className="px-4 py-2 text-ink/60">
                    {r.summary?.passedCases ?? 0}/{r.summary?.totalCases ?? 0}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink/50">
                    {formatTime(r.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
