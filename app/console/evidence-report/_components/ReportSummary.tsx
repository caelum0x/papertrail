import type { EvidenceReport } from "@/lib/evidenceReport";
import { CertaintyBadge } from "./CertaintyBadge";

// Top-of-report summary: the certainty badge, the synthesis verdict, and the
// stitched-together plain-language rationale a reviewer reads first.

interface ReportSummaryProps {
  report: EvidenceReport;
}

// Human-readable label for each synthesis verdict, mirroring the synthesis
// console's vocabulary so the two surfaces read consistently.
const VERDICT_LABEL: Record<string, string> = {
  matches_pooled: "Claim matches the pooled evidence",
  overstates_pooled: "Claim overstates the pooled evidence",
  understates_pooled: "Claim understates the pooled evidence",
  significance_mismatch: "Pooled evidence is not statistically significant",
  single_trial_cherry_pick: "Claim rests on a single favorable trial",
  high_heterogeneity: "Pooled estimate spans heterogeneous trials",
  insufficient_evidence: "Insufficient evidence to pool",
  not_comparable: "Claim states no comparable magnitude",
};

function verdictTone(verdict: string): string {
  if (verdict === "matches_pooled") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (verdict === "not_comparable" || verdict === "insufficient_evidence")
    return "border-ink/15 bg-white text-ink/80";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

export function ReportSummary({ report }: ReportSummaryProps) {
  const { certainty, verdict, rationale } = report;
  const label = VERDICT_LABEL[verdict.verdict] ?? verdict.verdict;

  return (
    <div className={`rounded-lg border p-5 ${verdictTone(verdict.verdict)}`}>
      <div className="flex flex-wrap items-center gap-3">
        <CertaintyBadge certainty={certainty.certainty} />
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <p className="mt-3 text-sm leading-relaxed">{rationale}</p>
      {verdict.claimedReductionPercent !== null || verdict.pooledReductionPercent !== null ? (
        <div className="mt-3 flex flex-wrap gap-6 text-xs text-ink/50">
          {verdict.claimedReductionPercent !== null ? (
            <span>
              Claimed reduction:{" "}
              <span className="font-medium text-ink/70">{verdict.claimedReductionPercent}%</span>
            </span>
          ) : null}
          {verdict.pooledReductionPercent !== null ? (
            <span>
              Pooled reduction:{" "}
              <span className="font-medium text-ink/70">{verdict.pooledReductionPercent}%</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
