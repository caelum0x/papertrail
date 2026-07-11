// Cumulative-evidence timeline: one row per study in accrual order, showing the
// running pooled estimate after each study lands and marking the step where
// significance was first reached and any step that flipped the pooled picture.
// All values come straight from the deterministic engine — this component only
// formats them.

import type { CumulativeMetaView, CumulativeStepView, EffectDirection } from "./types";

function directionLabel(d: EffectDirection): string {
  if (d === "protective") return "protective";
  if (d === "harmful") return "harmful";
  return "null";
}

function StepRow({
  step,
  firstSignificantAtOrder,
}: {
  step: CumulativeStepView;
  firstSignificantAtOrder: number | null;
}) {
  const isFirstSignificant = firstSignificantAtOrder === step.order;
  const flipped = step.flippedDirection || step.flippedSignificance;

  return (
    <tr className="border-t border-ink/10 align-top">
      <td className="py-2 pr-3 text-ink/40">{step.order}</td>
      <td className="py-2 pr-3">
        <div className="text-ink">{step.addedLabel}</div>
        <div className="text-xs text-ink/40">
          {step.year} · k = {step.k}
        </div>
      </td>
      <td className="py-2 pr-3 tabular-nums text-ink">
        {step.pooled
          ? `${step.pooled.point} [${step.pooled.ciLower}, ${step.pooled.ciUpper}]`
          : "—"}
      </td>
      <td className="py-2 pr-3">
        <span className="text-ink/70">{directionLabel(step.direction)}</span>
        {step.pooled ? (
          <span
            className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
              step.significant
                ? "bg-emerald-50 text-emerald-800"
                : "bg-ink/5 text-ink/50"
            }`}
          >
            {step.significant ? "significant" : "n.s."}
          </span>
        ) : null}
      </td>
      <td className="py-2">
        <div className="flex flex-wrap gap-1">
          {isFirstSignificant ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
              first significant
            </span>
          ) : null}
          {flipped ? (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800">
              {step.flippedDirection ? "direction flip" : "significance flip"}
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export function CumulativeTimeline({ cumulative }: { cumulative: CumulativeMetaView }) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-ink/70">Cumulative-evidence timeline</h3>
        <span className="text-xs text-ink/40">
          {cumulative.usableCount} usable
          {cumulative.skippedCount > 0 ? ` · ${cumulative.skippedCount} skipped` : ""}
          {cumulative.firstSignificantAtOrder
            ? ` · significant from study #${cumulative.firstSignificantAtOrder}`
            : " · never reached significance"}
        </span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-ink/40">
              <th className="pb-2 pr-3 font-medium">#</th>
              <th className="pb-2 pr-3 font-medium">Study added</th>
              <th className="pb-2 pr-3 font-medium">Pooled estimate</th>
              <th className="pb-2 pr-3 font-medium">Direction</th>
              <th className="pb-2 font-medium">Milestone</th>
            </tr>
          </thead>
          <tbody>
            {cumulative.steps.map((step) => (
              <StepRow
                key={step.order}
                step={step}
                firstSignificantAtOrder={cumulative.firstSignificantAtOrder}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
