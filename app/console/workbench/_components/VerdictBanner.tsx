"use client";

import type { EvidenceReportVerdict } from "./types";

// Synthesis verdict banner: color-codes the deterministic claim-vs-pool verdict and
// shows the rationale plus claimed vs pooled reduction side by side. Presentation
// only — the verdict and rationale come straight from the synthesis engine.

const TONE: Record<string, { label: string; box: string; dot: string }> = {
  matches_pooled: { label: "Matches pooled evidence", box: "border-green-300 bg-green-50", dot: "bg-green-500" },
  overstates_pooled: { label: "Overstates pooled evidence", box: "border-red-300 bg-red-50", dot: "bg-red-500" },
  understates_pooled: { label: "Understates pooled evidence", box: "border-amber-300 bg-amber-50", dot: "bg-amber-500" },
  significance_mismatch: { label: "Significance mismatch", box: "border-red-300 bg-red-50", dot: "bg-red-500" },
  single_trial_cherry_pick: { label: "Single-trial cherry-pick", box: "border-red-300 bg-red-50", dot: "bg-red-500" },
  high_heterogeneity: { label: "High heterogeneity", box: "border-amber-300 bg-amber-50", dot: "bg-amber-500" },
  insufficient_evidence: { label: "Insufficient evidence", box: "border-ink/20 bg-paper", dot: "bg-ink/40" },
  not_comparable: { label: "No comparable magnitude", box: "border-ink/20 bg-paper", dot: "bg-ink/40" },
};

interface VerdictBannerProps {
  verdict: EvidenceReportVerdict;
}

export function VerdictBanner({ verdict }: VerdictBannerProps) {
  const tone = TONE[verdict.verdict] ?? {
    label: verdict.verdict,
    box: "border-ink/20 bg-paper",
    dot: "bg-ink/40",
  };

  return (
    <div className={`rounded-lg border p-4 ${tone.box}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} aria-hidden />
        <h3 className="text-sm font-semibold text-ink/80">{tone.label}</h3>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink/70">{verdict.rationale}</p>

      {verdict.claimedReductionPercent !== null || verdict.pooledReductionPercent !== null ? (
        <div className="mt-3 flex flex-wrap gap-6 text-sm">
          {verdict.claimedReductionPercent !== null ? (
            <div>
              <div className="text-ink/40">Claimed reduction</div>
              <div className="font-mono text-ink/80">{verdict.claimedReductionPercent}%</div>
            </div>
          ) : null}
          {verdict.pooledReductionPercent !== null ? (
            <div>
              <div className="text-ink/40">Pooled reduction</div>
              <div className="font-mono text-ink/80">{verdict.pooledReductionPercent}%</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
