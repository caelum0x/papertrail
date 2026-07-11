// Deterministic subgroup / effect-modification analysis. This is the distortion a
// generic LLM claim-checker structurally cannot catch: a claim that quotes a real,
// statistically-significant effect — but one that only holds in a SUBGROUP, while the
// OVERALL (across-subgroup) effect is null or much weaker. "Drug X cut events by 40%"
// may be true for one pre-specified subgroup and false for the trial population.
//
// The engine pools each subgroup independently (reusing the meta-analysis engine),
// then runs the standard test for subgroup differences (the "interaction" test):
// Q_between = Σ_g w_g·(θ_g − θ_pooled)² on the log scale, where θ_g is subgroup g's
// pooled log-effect and w_g = 1/Var(θ_g). Under the null of no effect modification,
// Q_between ~ χ² with (G − 1) df — the exact form implemented by RevMan/metafor's
// test for subgroup differences. No LLM is in the numeric loop; every value is
// reproducible from the inputs. Pure: never mutates its arguments.

import { z } from "zod";
import {
  metaAnalyze,
  type MetaAnalysisResult,
  type RatioMeasure,
  type StudyEffectInput,
} from "./metaAnalysis";
import { claimedReductionPercent } from "./effectSize";
import { chiSquareSurvival } from "./stats/distributions";

// One subgroup (e.g. "diabetics", "age ≥ 65") and the studies reporting its effect.
export interface Subgroup {
  name: string;
  studies: StudyEffectInput[];
}

// A subgroup after pooling: its name plus the full meta-analysis of its studies.
export interface PooledSubgroup {
  name: string;
  pooled: MetaAnalysisResult;
  // Random-effects log-point and its variance — the inputs to the between-groups
  // test. Surfaced so the numbers behind Q_between are inspectable.
  logPoint: number;
  variance: number;
  reductionPercent: number;
}

export interface SubgroupAnalysisResult {
  subgroups: PooledSubgroup[];
  // Between-subgroup heterogeneity (the interaction / effect-modification test).
  qBetween: number;
  df: number;
  pValue: number;
  interactionSignificant: boolean; // p < 0.05
  // The effect pooled ACROSS every subgroup's study (the overall trial effect),
  // or null when fewer than two studies are poolable overall.
  overall: MetaAnalysisResult | null;
}

// Discrete verdict for a claim checked against a subgroup structure.
export type SubgroupVerdict =
  | "overall_effect_holds" // the claim matches the overall effect (not subgroup-specific)
  | "subgroup_only_effect" // the claim rests on ONE subgroup; the overall effect is weaker/absent
  | "no_interaction" // subgroups are homogeneous — no effect modification to flag
  | "insufficient_subgroups"; // fewer than two poolable subgroups to compare

export interface SubgroupCheck {
  verdict: SubgroupVerdict;
  rationale: string;
  claimedReductionPercent: number | null;
  overallReductionPercent: number | null;
  matchedSubgroup: string | null; // the subgroup whose effect the claim matches, if any
  matchedSubgroupReductionPercent: number | null;
  result: SubgroupAnalysisResult | null;
}

// A claimed reduction must land within this factor of a subgroup's reduction to
// count as "matching" it — and must be materially larger than the overall effect
// (by the same factor) to be called subgroup-only. Mirrors the synthesis engine.
const MATCH_FACTOR = 1.5;
// A subgroup below this p-value threshold on the interaction test is "significant".
const ALPHA = 0.05;

const SIGNIFICANCE = 0.05;

function round(n: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// Round a p-value for display WITHOUT ever collapsing a genuinely positive p to exactly 0 —
// a scientist never reports "p = 0". Below the 4-dp display resolution we keep two significant
// figures (e.g. 9.5e-7), so a highly significant interaction reads as small-but-positive.
function roundP(p: number): number {
  if (p <= 0) return 0;
  const r = round(p, 4);
  return r > 0 ? r : Number(p.toPrecision(2));
}

// True when two positive magnitudes are within MATCH_FACTOR of each other. For
// small/near-zero reductions, fall back to an absolute 5-point window (a 2% and a
// 3% reduction are "close"; a 5% and a 40% are not).
function magnitudesClose(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return Math.abs(a - b) < 5;
  return a <= b * MATCH_FACTOR && b <= a * MATCH_FACTOR;
}

/**
 * Pool each subgroup, then run the test for subgroup differences. Returns null-safe
 * per subgroup: a subgroup that cannot be pooled (fewer than two usable studies) is
 * dropped from the between-groups test but does not fail the whole analysis.
 *
 * Q_between = Σ_g w_g·(θ_g − θ_pooled)², w_g = 1/Var(θ_g), θ_pooled = Σw_g·θ_g / Σw_g,
 * evaluated on the natural-log scale using each subgroup's random-effects estimate.
 * df = (G − 1); p-value from the upper-tail χ². interactionSignificant when p < 0.05.
 *
 * Pure: does not mutate its inputs.
 */
export function subgroupAnalysis(subgroups: readonly Subgroup[]): SubgroupAnalysisResult {
  const pooledSubgroups: PooledSubgroup[] = [];

  for (const sg of subgroups) {
    const pooled = metaAnalyze(sg.studies);
    if (!pooled) continue; // fewer than two poolable studies in this subgroup
    // Use the random-effects estimate on the log scale — the standard basis for the
    // between-groups test (each subgroup carries its own within-group variance).
    const logPoint = pooled.random.logPoint;
    const variance = pooled.random.se * pooled.random.se;
    if (!Number.isFinite(logPoint) || !Number.isFinite(variance) || variance <= 0) continue;
    pooledSubgroups.push({
      name: sg.name,
      pooled,
      logPoint,
      variance,
      reductionPercent: pooled.random.reductionPercent,
    });
  }

  // Overall pool = every study across every subgroup, treated as one meta-analysis.
  const allStudies: StudyEffectInput[] = subgroups.flatMap((sg) => sg.studies);
  const overall = metaAnalyze(allStudies);

  const g = pooledSubgroups.length;
  if (g < 2) {
    return {
      subgroups: pooledSubgroups,
      qBetween: 0,
      df: g > 0 ? g - 1 : 0,
      pValue: 1,
      interactionSignificant: false,
      overall,
    };
  }

  // Between-groups weights and pooled log-effect across subgroups.
  const weights = pooledSubgroups.map((s) => 1 / s.variance);
  const sumW = weights.reduce((acc, w) => acc + w, 0);
  const sumWy = pooledSubgroups.reduce((acc, s, i) => acc + weights[i] * s.logPoint, 0);
  const thetaPooled = sumWy / sumW;

  const qBetween = pooledSubgroups.reduce(
    (acc, s, i) => acc + weights[i] * (s.logPoint - thetaPooled) ** 2,
    0
  );
  const df = g - 1;
  const pValue = chiSquareSurvival(qBetween, df);

  return {
    subgroups: pooledSubgroups,
    qBetween: round(qBetween, 4),
    df,
    pValue: roundP(pValue),
    interactionSignificant: pValue < SIGNIFICANCE,
    overall,
  };
}

/**
 * Verify a claim's stated magnitude against a subgroup structure. Fires the
 * `subgroup_only_effect` flag ONLY when the claim's magnitude matches ONE subgroup's
 * pooled effect, does NOT match the overall effect, AND the interaction test is
 * significant (p < 0.05) — the exact signature of a claim that rests on a subgroup
 * rather than the trial-wide result. Otherwise defers to a homogeneous / overall
 * verdict rather than over-claiming. Pure.
 */
export function verifyAgainstSubgroups(
  claim: string,
  subgroups: readonly Subgroup[]
): SubgroupCheck {
  const result = subgroupAnalysis(subgroups);
  const claimed = claimedReductionPercent(claim);

  if (result.subgroups.length < 2 || !result.overall) {
    return {
      verdict: "insufficient_subgroups",
      rationale:
        "Fewer than two subgroups could be pooled (each needs at least two usable studies), or the overall population could not be pooled — there is no subgroup contrast to test for effect modification.",
      claimedReductionPercent: claimed,
      overallReductionPercent: result.overall ? round(result.overall.random.reductionPercent) : null,
      matchedSubgroup: null,
      matchedSubgroupReductionPercent: null,
      result,
    };
  }

  const overallReduction = result.overall.random.reductionPercent;
  const overallText = `${result.overall.measure} ${result.overall.random.point} (95% CI ${result.overall.random.ciLower}–${result.overall.random.ciUpper})`;

  // The subgroup whose pooled effect the claim's magnitude matches, if any.
  const matched =
    claimed !== null
      ? result.subgroups.find((s) => magnitudesClose(claimed, s.reductionPercent)) ?? null
      : null;

  // No effect modification: the subgroups agree (interaction not significant). The
  // claim — whatever its magnitude — cannot be "subgroup-specific" if the subgroups
  // don't differ. This is the reassuring case.
  if (!result.interactionSignificant) {
    return {
      verdict: "no_interaction",
      rationale: `The test for subgroup differences is not significant (Q_between=${result.qBetween}, df=${result.df}, p=${result.pValue} ≥ ${ALPHA}). The subgroups are statistically consistent, so there is no effect modification — the effect does not depend on the subgroup, and the overall estimate ${overallText} applies.`,
      claimedReductionPercent: claimed,
      overallReductionPercent: round(overallReduction),
      matchedSubgroup: null,
      matchedSubgroupReductionPercent: null,
      result,
    };
  }

  // Interaction IS significant. If the claim matches one subgroup but NOT the overall
  // effect, the claim rests on that subgroup rather than the trial-wide result.
  if (
    matched !== null &&
    claimed !== null &&
    !magnitudesClose(claimed, overallReduction) &&
    (overallReduction <= 0 || claimed > overallReduction * MATCH_FACTOR)
  ) {
    return {
      verdict: "subgroup_only_effect",
      rationale: `The claimed ~${round(claimed)}% reduction matches the "${matched.name}" subgroup (${matched.pooled.measure} ${matched.pooled.random.point},~${round(matched.reductionPercent)}% reduction), but NOT the overall population, which pooled to ${overallText} (~${round(overallReduction)}% reduction). The test for subgroup differences is significant (Q_between=${result.qBetween}, df=${result.df}, p=${result.pValue} < ${ALPHA}), confirming genuine effect modification — the claim rests on a subgroup, not the trial-wide effect.`,
      claimedReductionPercent: round(claimed),
      overallReductionPercent: round(overallReduction),
      matchedSubgroup: matched.name,
      matchedSubgroupReductionPercent: round(matched.reductionPercent),
      result,
    };
  }

  // Interaction significant, but the claim matches the overall effect (or states no
  // comparable magnitude): the claim is not subgroup-specific, even though the
  // subgroups differ. We surface the significant interaction as context.
  return {
    verdict: "overall_effect_holds",
    rationale:
      claimed !== null
        ? `Although the test for subgroup differences is significant (Q_between=${result.qBetween}, df=${result.df}, p=${result.pValue} < ${ALPHA}), the claimed ~${round(claimed)}% reduction is consistent with the OVERALL pooled effect ${overallText} (~${round(overallReduction)}% reduction) — the claim reflects the trial-wide result, not a single subgroup.`
        : `The test for subgroup differences is significant (Q_between=${result.qBetween}, df=${result.df}, p=${result.pValue} < ${ALPHA}), so the effect varies by subgroup, but the claim states no comparable numeric magnitude to attribute to a specific subgroup. The overall pooled effect is ${overallText} (~${round(overallReduction)}% reduction).`,
    claimedReductionPercent: claimed !== null ? round(claimed) : null,
    overallReductionPercent: round(overallReduction),
    matchedSubgroup: matched ? matched.name : null,
    matchedSubgroupReductionPercent: matched ? round(matched.reductionPercent) : null,
    result,
  };
}

// ---- Boundary validation (Zod) --------------------------------------------------

const RATIO_MEASURES = ["RR", "HR", "OR"] as const satisfies readonly RatioMeasure[];

// A single study within a subgroup: either point+CI or the four 2x2 counts.
const SubgroupStudySchema = z.object({
  label: z.string().min(1).max(200),
  measure: z.enum(RATIO_MEASURES),
  point: z.number().positive().nullable().optional(),
  ci_lower: z.number().positive().nullable().optional(),
  ci_upper: z.number().positive().nullable().optional(),
  ci_pct: z.number().min(50).max(99.99).nullable().optional(),
  events1: z.number().int().min(0).nullable().optional(),
  total1: z.number().int().min(0).nullable().optional(),
  events2: z.number().int().min(0).nullable().optional(),
  total2: z.number().int().min(0).nullable().optional(),
});

const SubgroupSchema = z.object({
  name: z.string().min(1).max(200),
  studies: z.array(SubgroupStudySchema).min(1).max(100),
});

export const SubgroupRequestSchema = z.object({
  claim: z.string().min(10).max(2000),
  subgroups: z.array(SubgroupSchema).min(1).max(20),
});

export type SubgroupRequest = z.infer<typeof SubgroupRequestSchema>;
export type SubgroupStudyInput = z.infer<typeof SubgroupStudySchema>;

// Map a snake_case request study to the engine's camelCase StudyEffectInput.
export function toEngineStudy(study: SubgroupStudyInput): StudyEffectInput {
  return {
    label: study.label,
    measure: study.measure,
    point: study.point ?? null,
    ciLower: study.ci_lower ?? null,
    ciUpper: study.ci_upper ?? null,
    ciPct: study.ci_pct ?? null,
    events1: study.events1 ?? null,
    total1: study.total1 ?? null,
    events2: study.events2 ?? null,
    total2: study.total2 ?? null,
  };
}
