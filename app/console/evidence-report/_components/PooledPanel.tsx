import type { MetaAnalysisResult } from "@/lib/metaAnalysis";

// Pooled fixed + random estimates and heterogeneity, laid out as a compact
// stats grid. Pure presentation of numbers the engine already produced.

interface PooledPanelProps {
  pooled: MetaAnalysisResult;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ink/40">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-ink/80">{value}</div>
    </div>
  );
}

function ci(point: number, lower: number, upper: number): string {
  return `${point} (${lower}–${upper})`;
}

export function PooledPanel({ pooled }: PooledPanelProps) {
  const { fixed, random, heterogeneity, predictionInterval } = pooled;
  return (
    <div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label={`Fixed ${pooled.measure}`} value={ci(fixed.point, fixed.ciLower, fixed.ciUpper)} />
        <Stat
          label={`Random ${pooled.measure}`}
          value={ci(random.point, random.ciLower, random.ciUpper)}
        />
        <Stat label="Studies (k)" value={String(pooled.k)} />
        <Stat
          label="Significant"
          value={random.significant ? "Yes (95% CI excludes 1)" : "No (CI crosses 1)"}
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-ink/10 pt-4 sm:grid-cols-4">
        <Stat label="I²" value={`${heterogeneity.iSquared}%`} />
        <Stat label="Cochran's Q" value={`${heterogeneity.q} (df ${heterogeneity.df})`} />
        <Stat label="τ²" value={String(heterogeneity.tauSquared)} />
        <Stat
          label="Prediction interval"
          value={
            predictionInterval
              ? `${predictionInterval.lower}–${predictionInterval.upper}`
              : "n/a (k < 3)"
          }
        />
      </div>
      {pooled.skipped.length > 0 ? (
        <p className="mt-4 text-xs text-ink/50">
          {pooled.skipped.length} study/studies were dropped from the pool:{" "}
          {pooled.skipped.map((s) => `${s.label} (${s.reason})`).join("; ")}
        </p>
      ) : null}
    </div>
  );
}
