import { accuracyClasses, formatPercent, type EvalRun } from "../lib";

// The four headline metric cards for a run: accuracy, span grounding, passed,
// and errored cases.

interface RunMetricCardsProps {
  run: EvalRun;
}

export function RunMetricCards({ run }: RunMetricCardsProps) {
  const summary = run.summary;
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className={`rounded-lg border p-4 ${accuracyClasses(run.accuracy)}`}>
        <div className="text-xs opacity-70">Accuracy</div>
        <div className="mt-1 text-2xl font-semibold">
          {formatPercent(run.accuracy)}
        </div>
      </div>
      <div className="rounded-lg border border-ink/10 bg-white p-4">
        <div className="text-xs text-ink/40">Span grounding</div>
        <div className="mt-1 text-2xl font-semibold text-ink/80">
          {formatPercent(run.spanGroundingRate)}
        </div>
      </div>
      <div className="rounded-lg border border-ink/10 bg-white p-4">
        <div className="text-xs text-ink/40">Passed</div>
        <div className="mt-1 text-2xl font-semibold text-ink/80">
          {summary?.passedCases ?? 0}/{summary?.totalCases ?? 0}
        </div>
      </div>
      <div className="rounded-lg border border-ink/10 bg-white p-4">
        <div className="text-xs text-ink/40">Errored cases</div>
        <div className="mt-1 text-2xl font-semibold text-ink/80">
          {summary?.errorCases ?? 0}
        </div>
      </div>
    </div>
  );
}
