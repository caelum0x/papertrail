import Link from "next/link";
import { formatTime, formatPercent, type EvalRun } from "../lib";

// Bar-chart of accuracy over recent completed runs, linking to each run.

interface AccuracyTrendProps {
  runs: EvalRun[];
}

export function AccuracyTrend({ runs }: AccuracyTrendProps) {
  return (
    <div className="mt-6 rounded-lg border border-ink/10 bg-white p-4">
      <h2 className="text-sm font-medium text-ink/80">Accuracy over time</h2>
      {runs.length === 0 ? (
        <p className="mt-2 text-sm text-ink/40">
          No completed runs yet. Create a set, add cases, and run it to see
          accuracy trend here.
        </p>
      ) : (
        <div className="mt-3 flex items-end gap-2">
          {[...runs].reverse().map((r) => (
            <Link
              key={r.id}
              href={`/console/evaluation/runs/${r.id}`}
              className="group flex flex-1 flex-col items-center gap-1"
              title={`${formatPercent(r.accuracy)} · ${formatTime(r.createdAt)}`}
            >
              <div className="flex h-24 w-full items-end">
                <div
                  className="w-full rounded-t bg-accent/70 group-hover:bg-accent"
                  style={{ height: `${Math.max(4, (r.accuracy ?? 0) * 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-ink/50">
                {formatPercent(r.accuracy)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
