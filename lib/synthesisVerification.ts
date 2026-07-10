// Deterministic synthesis verification: check a claim against the POOLED totality
// of evidence across N sources, not a single trial. This extends PaperTrail's moat
// from single-source registry checking to evidence synthesis — the thing a generic
// LLM claim-checker cannot reproduce. No LLM is in the numeric loop: the pooled
// estimate comes entirely from `metaAnalyze`, and this layer only applies
// rule-decidable comparisons on top of it, deferring when a case isn't decidable.

import { TrialResultAnalysis } from "./sources/clinicaltrials";
import { claimedReductionPercent } from "./effectSize";
import {
  metaAnalyze,
  type MetaAnalysisResult,
  type RatioMeasure,
  type StudyEffectInput,
} from "./metaAnalysis";

export type SynthesisVerdict =
  | "matches_pooled" // claim's magnitude agrees with the pooled estimate
  | "overstates_pooled" // claim materially exceeds the pooled effect
  | "understates_pooled" // claim is materially smaller than the pooled effect
  | "significance_mismatch" // claim asserts benefit but the pooled CI crosses the null
  | "single_trial_cherry_pick" // claim matches one trial but overstates the pooled effect
  | "high_heterogeneity" // studies too inconsistent for a pooled estimate to be trusted
  | "insufficient_evidence" // fewer than two comparable trials to pool
  | "not_comparable"; // pooled estimate exists but the claim has no comparable magnitude

export interface SynthesisSource {
  label: string;
  analyses: TrialResultAnalysis[];
}

export interface SynthesisCheck {
  verdict: SynthesisVerdict;
  rationale: string;
  claimedReductionPercent: number | null;
  pooledReductionPercent: number | null;
  measure: RatioMeasure | null;
  pooled: MetaAnalysisResult | null;
}

// A claimed effect must exceed the pooled effect by this factor to be "overstated".
const OVERSTATE_FACTOR = 1.5;
// I² at or above this is conventionally "considerable" heterogeneity (Cochrane).
const HIGH_I2 = 75;

const BENEFIT_RE =
  /\b(reduc\w*|lower\w*|cut\w*|decreas\w*|improv\w*|effective|benefit\w*|prevent\w*|halv\w*|cuts?\b)/i;

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

// Map a registered analysis's paramType to a ratio measure, or null if not a ratio.
function measureOf(paramType: string | null): RatioMeasure | null {
  if (!paramType) return null;
  const p = paramType.toLowerCase();
  if (p.includes("hazard ratio") || /\bhr\b/.test(p)) return "HR";
  if (p.includes("odds ratio") || /\bor\b/.test(p)) return "OR";
  if (p.includes("risk ratio") || p.includes("relative risk") || p.includes("rate ratio") || /\brr\b/.test(p))
    return "RR";
  return null;
}

// Pick a source's most citable ratio analysis: prefer the PRIMARY outcome.
function primaryRatioAnalysis(analyses: TrialResultAnalysis[]): TrialResultAnalysis | null {
  const usable = analyses.filter(
    (a) => measureOf(a.paramType) !== null && a.paramValue !== null && a.paramValue > 0
  );
  if (usable.length === 0) return null;
  return usable.find((a) => a.outcomeType === "PRIMARY") ?? usable[0];
}

function magnitudesClose(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return Math.abs(a - b) < 5;
  return a <= b * OVERSTATE_FACTOR && b <= a * OVERSTATE_FACTOR;
}

/**
 * Build meta-analysis inputs from a set of sources. Chooses the dominant ratio
 * measure across the sources' primary analyses (you can't pool HRs with ORs) and
 * emits one `StudyEffectInput` per source that reports that measure with a CI.
 */
export function buildSynthesisInputs(sources: readonly SynthesisSource[]): {
  measure: RatioMeasure | null;
  inputs: StudyEffectInput[];
} {
  const perSource = sources
    .map((s) => ({ label: s.label, analysis: primaryRatioAnalysis(s.analyses) }))
    .filter((s): s is { label: string; analysis: TrialResultAnalysis } => s.analysis !== null);

  if (perSource.length === 0) return { measure: null, inputs: [] };

  // Dominant measure = the most common ratio measure among the primary analyses.
  const counts = new Map<RatioMeasure, number>();
  for (const { analysis } of perSource) {
    const m = measureOf(analysis.paramType);
    if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  let measure: RatioMeasure | null = null;
  let best = 0;
  for (const [m, n] of counts) {
    if (n > best) {
      best = n;
      measure = m;
    }
  }
  if (!measure) return { measure: null, inputs: [] };

  const inputs: StudyEffectInput[] = [];
  for (const { label, analysis } of perSource) {
    if (measureOf(analysis.paramType) !== measure) continue;
    // Only pool analyses that carry a usable CI (needed to weight by variance).
    if (analysis.ciLower === null || analysis.ciUpper === null) continue;
    inputs.push({
      label,
      measure,
      point: analysis.paramValue as number,
      ciLower: analysis.ciLower,
      ciUpper: analysis.ciUpper,
      ciPct: analysis.ciPct ?? 95,
    });
  }
  return { measure, inputs };
}

/**
 * Verify a claim's stated magnitude against the pooled random-effects estimate
 * across `sources`. Deterministic and defensible: it fires only on rule-decidable
 * cases (overstatement, understatement, significance loss, single-trial
 * cherry-picking, considerable heterogeneity) and otherwise defers. Pure.
 */
export function verifyAgainstSynthesis(
  claim: string,
  sources: readonly SynthesisSource[]
): SynthesisCheck {
  const { measure, inputs } = buildSynthesisInputs(sources);
  const pooled = inputs.length >= 2 ? metaAnalyze(inputs) : null;

  if (!pooled) {
    return {
      verdict: "insufficient_evidence",
      rationale:
        "Fewer than two sources report a comparable registered ratio result with a confidence interval, so there is no pooled estimate to check the claim against.",
      claimedReductionPercent: null,
      pooledReductionPercent: null,
      measure,
      pooled: null,
    };
  }

  const pooledReduction = pooled.random.reductionPercent;
  const claimed = claimedReductionPercent(claim);
  const assertsBenefit = BENEFIT_RE.test(claim);
  const i2 = pooled.heterogeneity.iSquared;
  const ciText = `${pooled.measure} ${pooled.random.point} (95% CI ${pooled.random.ciLower}–${pooled.random.ciUpper}, k=${pooled.k}, I²=${i2}%)`;

  // Significance: the claim asserts a benefit but the pooled CI includes the null.
  if (assertsBenefit && !pooled.random.significant) {
    return {
      verdict: "significance_mismatch",
      rationale: `The claim asserts a benefit, but the pooled random-effects estimate ${ciText} has a confidence interval that crosses the null of 1 — the totality of evidence is not statistically significant.`,
      claimedReductionPercent: claimed,
      pooledReductionPercent: round(pooledReduction),
      measure,
      pooled,
    };
  }

  if (claimed === null) {
    return {
      verdict: "not_comparable",
      rationale: `Pooled across ${pooled.k} trials: ${ciText} — about a ${round(pooledReduction)}% reduction. The claim states no comparable numeric magnitude to reconcile.`,
      claimedReductionPercent: null,
      pooledReductionPercent: round(pooledReduction),
      measure,
      pooled,
    };
  }

  // Overstatement — with a cherry-pick refinement: does the claim match a single
  // trial even though it overstates the pool? That is the classic distortion of
  // citing the most favorable trial as if it were the settled result.
  if (pooledReduction > 0 && claimed > pooledReduction * OVERSTATE_FACTOR) {
    const matchingTrial = pooled.studies.find((s) =>
      magnitudesClose(claimed, (1 - s.point) * 100)
    );
    if (matchingTrial) {
      return {
        verdict: "single_trial_cherry_pick",
        rationale: `The claim's ~${round(claimed)}% reduction matches a single trial (${matchingTrial.label}: ${matchingTrial.measure} ${matchingTrial.point}), but the pooled estimate across all ${pooled.k} trials is ${ciText} — about a ${round(pooledReduction)}% reduction. The claim rests on the most favorable trial, not the totality of evidence.`,
        claimedReductionPercent: round(claimed),
        pooledReductionPercent: round(pooledReduction),
        measure,
        pooled,
      };
    }
    return {
      verdict: "overstates_pooled",
      rationale: `The claim implies a ~${round(claimed)}% reduction, but the pooled estimate across ${pooled.k} trials is ${ciText} — about a ${round(pooledReduction)}% reduction. The claim overstates the totality of the evidence.`,
      claimedReductionPercent: round(claimed),
      pooledReductionPercent: round(pooledReduction),
      measure,
      pooled,
    };
  }

  if (pooledReduction > 0 && claimed * OVERSTATE_FACTOR < pooledReduction) {
    return {
      verdict: "understates_pooled",
      rationale: `The claim implies a ~${round(claimed)}% reduction, but the pooled estimate across ${pooled.k} trials is ${ciText} — about a ${round(pooledReduction)}% reduction. The claim understates the pooled effect.`,
      claimedReductionPercent: round(claimed),
      pooledReductionPercent: round(pooledReduction),
      measure,
      pooled,
    };
  }

  // The claim's magnitude agrees with the pool. If the trials are considerably
  // heterogeneous, that agreement is fragile — flag it rather than bless it.
  if (i2 >= HIGH_I2) {
    return {
      verdict: "high_heterogeneity",
      rationale: `The claim's ~${round(claimed)}% reduction is close to the pooled estimate ${ciText}, but I²=${i2}% indicates considerable heterogeneity between trials — the pooled figure spans genuinely different effects and should be cited with that caveat.`,
      claimedReductionPercent: round(claimed),
      pooledReductionPercent: round(pooledReduction),
      measure,
      pooled,
    };
  }

  return {
    verdict: "matches_pooled",
    rationale: `The claim's ~${round(claimed)}% reduction agrees with the pooled estimate across ${pooled.k} trials: ${ciText}.`,
    claimedReductionPercent: round(claimed),
    pooledReductionPercent: round(pooledReduction),
    measure,
    pooled,
  };
}
