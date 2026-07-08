"use client";

import type { ReportRun } from "@/lib/reporting/types";
import { StatusBadge } from "./StatusBadge";
import { ResultView } from "./ResultView";
import { formatDate } from "./format";

interface RunDetailProps {
  run: ReportRun | null;
}

// Right-hand panel showing the selected run's composed result, or a prompt to
// pick a run when none is selected.
export function RunDetail({ run }: RunDetailProps) {
  if (!run) {
    return (
      <div className="rounded-lg border border-ink/15 bg-white p-6 text-center text-sm text-ink/40">
        Select a run to view its result.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink/80">Run detail</h2>
        <StatusBadge status={run.status} />
      </div>
      <p className="mt-1 text-xs text-ink/40">
        {run.format.toUpperCase()} · {formatDate(run.createdAt)}
      </p>

      <div className="mt-4">
        {run.status === "failed" ? (
          <p className="text-sm text-red-700">
            {run.error ?? "This run failed to compose."}
          </p>
        ) : run.result ? (
          <ResultView result={run.result} />
        ) : (
          <p className="text-sm text-ink/40">No result recorded for this run.</p>
        )}
      </div>
    </div>
  );
}
