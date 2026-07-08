import type { RunDetail } from "@/lib/workflows/repository";
import { RunStatus } from "./RunStatus";
import { JsonBlock } from "./JsonBlock";
import { formatDateTime } from "./format";

// Header card for a run trace: title, status, timings, error, and input.

interface RunSummaryCardProps {
  run: RunDetail;
}

export function RunSummaryCard({ run }: RunSummaryCardProps) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink/80">
            {run.workflowKey ?? "Run"}
          </h1>
          <p className="mt-1 text-sm text-ink/40">Run {run.id.slice(0, 8)}</p>
        </div>
        <RunStatus status={run.status} />
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink/40">
            Started
          </dt>
          <dd className="mt-0.5 text-sm text-ink/80">
            {formatDateTime(run.startedAt)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink/40">
            Finished
          </dt>
          <dd className="mt-0.5 text-sm text-ink/80">
            {formatDateTime(run.finishedAt)}
          </dd>
        </div>
      </dl>

      {run.error ? (
        <div className="mt-4 rounded-md border border-red-600/30 bg-red-50 p-3 text-sm text-red-700">
          {run.error}
        </div>
      ) : null}

      <div className="mt-4">
        <div className="text-xs uppercase tracking-wide text-ink/40">Input</div>
        <JsonBlock value={run.input} />
      </div>
    </div>
  );
}
