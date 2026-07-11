import type { FragilityResult } from "./types";
import { VERDICT_STYLES } from "./types";

// Renders a deterministic fragility result: a verdict badge, the headline
// number (Fragility Index for a single table, or the leave-one-out outcome for a
// meta set), and every supporting statistic the engine returned. Purely
// presentational — it re-derives nothing.

interface ResultViewProps {
  result: FragilityResult;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-ink/15 bg-paper px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-ink/80">{value}</div>
    </div>
  );
}

export function ResultView({ result }: ResultViewProps) {
  const style = VERDICT_STYLES[result.verdict];

  return (
    <div className="space-y-4 rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-ink/70">Fragility verdict</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}>
          {style.label}
        </span>
      </div>

      {result.kind === "table" ? (
        <div className="grid gap-2 sm:grid-cols-4">
          <Stat
            label="Fragility index"
            value={result.fragilityIndex === null ? "—" : String(result.fragilityIndex)}
          />
          <Stat label="Baseline p (Fisher)" value={result.detail.baselineP.toFixed(4)} />
          <Stat
            label="Flipped p"
            value={result.detail.flippedP === null ? "—" : result.detail.flippedP.toFixed(4)}
          />
          <Stat
            label="Arm reassigned"
            value={result.detail.smallerEventArm === null ? "—" : `Arm ${result.detail.smallerEventArm}`}
          />
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-4">
          <Stat label="Studies pooled" value={String(result.robustness.k)} />
          <Stat
            label="Pooled significant"
            value={result.robustness.pooledSignificant ? "Yes" : "No"}
          />
          <Stat
            label="Survives LOO"
            value={result.robustness.survivesLeaveOneOut ? "Yes" : "No"}
          />
          <Stat
            label="Information size met"
            value={
              result.informationSizeMet === null
                ? "—"
                : result.informationSizeMet
                  ? "Yes"
                  : "No"
            }
          />
        </div>
      )}

      <p className="text-sm leading-relaxed text-ink/70">{result.interpretation}</p>

      {result.kind === "meta" && result.informationSize ? (
        <div className="rounded-md border border-ink/15 bg-paper px-3 py-2 text-xs text-ink/60">
          Accrued N {result.informationSize.accruedN} / required {result.informationSize.requiredN} (
          {(result.informationSize.informationFraction * 100).toFixed(1)}% of information size)
        </div>
      ) : null}

      {result.kind === "meta" && result.robustness.flippingStudy ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          Pivotal study: removing &ldquo;{result.robustness.flippingStudy}&rdquo; alone flips the pooled verdict.
        </div>
      ) : null}
    </div>
  );
}
