"use client";

import type { MetaAnalysisResult, PublicationBiasReport } from "./types";

// Numeric summary of the pooled result plus the Egger publication-bias note: fixed
// & random estimates, heterogeneity (I²/τ²/Q), prediction interval, and the
// small-study-effects test. Presentation only; every value comes from the engines.

interface PooledStatsPanelProps {
  pooled: MetaAnalysisResult;
  publicationBias: PublicationBiasReport;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-ink/10 bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-ink/40">{label}</div>
      <div className="mt-1 font-mono text-sm text-ink/80">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-ink/40">{hint}</div> : null}
    </div>
  );
}

const BIAS_TONE: Record<string, string> = {
  possible_small_study_effects: "border-amber-300 bg-amber-50 text-amber-800",
  no_small_study_effects: "border-green-300 bg-green-50 text-green-800",
  insufficient_studies: "border-ink/15 bg-paper text-ink/60",
};

export function PooledStatsPanel({ pooled, publicationBias }: PooledStatsPanelProps) {
  const { fixed, random, heterogeneity: h, predictionInterval: pi, measure } = pooled;
  const ci = (lo: number, hi: number) => `${lo}–${hi}`;
  const biasTone = BIAS_TONE[publicationBias.verdict] ?? "border-ink/15 bg-paper text-ink/60";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Random effects"
          value={`${measure} ${random.point}`}
          hint={`95% CI ${ci(random.ciLower, random.ciUpper)}${random.significant ? " · significant" : " · crosses null"}`}
        />
        <Stat
          label="Fixed effect"
          value={`${measure} ${fixed.point}`}
          hint={`95% CI ${ci(fixed.ciLower, fixed.ciUpper)}`}
        />
        <Stat label="Studies pooled" value={`k = ${pooled.k}`} />
        <Stat
          label="Prediction interval"
          value={pi ? ci(pi.lower, pi.upper) : "n/a"}
          hint={pi ? "95% PI for a new trial" : "needs k ≥ 3"}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="I²" value={`${h.iSquared}%`} hint="between-study variability" />
        <Stat label="τ²" value={`${h.tauSquared}`} hint="between-study variance" />
        <Stat label="Cochran's Q" value={`${h.q}`} hint={`df = ${h.df}, p = ${h.pValue}`} />
        <Stat label="H²" value={`${h.hSquared}`} hint="Q / df" />
      </div>

      <div className={`rounded-md border p-3 text-sm ${biasTone}`}>
        <div className="text-xs font-semibold uppercase tracking-wide">Publication bias (Egger)</div>
        <p className="mt-1 leading-relaxed">{publicationBias.note}</p>
      </div>

      {pooled.skipped.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            {pooled.skipped.length} study{pooled.skipped.length === 1 ? "" : "ies"} skipped
          </div>
          <ul className="mt-1 space-y-0.5 text-sm text-ink/60">
            {pooled.skipped.map((s, i) => (
              <li key={`${s.label}-${i}`}>
                <span className="font-medium text-ink/70">{s.label || "(unlabeled)"}:</span> {s.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
