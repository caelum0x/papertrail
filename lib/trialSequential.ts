// Deterministic TRIAL SEQUENTIAL ANALYSIS (TSA).
//
// A cumulative (pooled) meta-analysis accrues evidence study by study. The
// naive question "is the pooled effect significant?" is dangerously optimistic:
// repeatedly testing an accumulating body of evidence inflates the false-positive
// rate exactly like interim analyses in a single trial. TSA answers the question
// a generic significance checker cannot: is the pooled evidence CONCLUSIVE, or is
// more data still needed?
//
// It does this with two classic single-trial devices ported to meta-analysis:
//   1. A Required Information Size (RIS) — the total sample size a definitive
//      trial would need to detect the anticipated effect at the chosen alpha/power,
//      optionally inflated for between-study heterogeneity (diversity, I²).
//   2. A Lan–DeMets O'Brien–Fleming alpha-spending Z boundary that is very strict
//      early (little information accrued) and relaxes toward the conventional Z as
//      the accrued information approaches the RIS — controlling the type-I error
//      across the sequence of cumulative looks.
//
// NO LLM is in this loop. Every value is a pure closed-form computation reusing
// lib/stats/distributions for all quantiles; the same inputs always reproduce the
// same verdict.

import { z } from "zod";
import { normalQuantile } from "./stats/distributions";

// ---------------------------------------------------------------------------
// Zod boundary schemas
// ---------------------------------------------------------------------------

// I² is a proportion in [0, 1). We forbid exactly 1 because the diversity
// inflation factor 1/(1 - I²) diverges there.
const iSquaredSchema = z.number().finite().min(0).max(0.999);

export const RequiredInformationSizeSchema = z.object({
  controlRisk: z.number().finite().gt(0).lt(1),
  relativeRiskReduction: z.number().finite().gt(0).lt(1),
  alpha: z.number().finite().gt(0).lt(1).default(0.05),
  power: z.number().finite().gt(0).lt(1).default(0.8),
  iSquared: iSquaredSchema.optional(),
});
// z.input so callers may omit the `.default()`-backed fields (alpha/power); the
// parse inside the function fills them in.
export type RequiredInformationSizeInput = z.input<typeof RequiredInformationSizeSchema>;

export const ObrienFlemingBoundarySchema = z.object({
  informationFraction: z.number().finite().gt(0).lte(1),
  alpha: z.number().finite().gt(0).lt(1).default(0.05),
});
export type ObrienFlemingBoundaryInput = z.input<typeof ObrienFlemingBoundarySchema>;

export const TrialSequentialVerdictSchema = z.object({
  accruedN: z.number().finite().nonnegative(),
  ris: z.number().finite().positive(),
  cumulativeZ: z.number().finite(),
  alpha: z.number().finite().gt(0).lt(1).default(0.05),
});
export type TrialSequentialVerdictInput = z.input<typeof TrialSequentialVerdictSchema>;

// A single request envelope so the public route can dispatch by mode.
export const TrialSequentialRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("ris") }).merge(RequiredInformationSizeSchema),
  z.object({ mode: z.literal("boundary") }).merge(ObrienFlemingBoundarySchema),
  z.object({ mode: z.literal("verdict") }).merge(TrialSequentialVerdictSchema),
]);
export type TrialSequentialRequest = z.infer<typeof TrialSequentialRequestSchema>;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface RequiredInformationSizeResult {
  risPerGroup: number;
  risTotal: number;
  p1: number; // treatment-arm risk = controlRisk * (1 - RRR)
  p2: number; // control-arm risk
  diversityAdjusted: boolean;
}

export interface ObrienFlemingBoundaryResult {
  z: number;
  informationFraction: number;
}

export type TrialSequentialDecision =
  | "conclusive_benefit"
  | "conclusive_no_effect"
  | "insufficient_information";

export interface TrialSequentialVerdictResult {
  verdict: TrialSequentialDecision;
  informationFraction: number;
  boundaryZ: number;
  cumulativeZ: number;
  crossedBenefit: boolean;
  crossedNoEffect: boolean;
  rationale: string;
}

// ---------------------------------------------------------------------------
// 1. Required Information Size
// ---------------------------------------------------------------------------

/**
 * Required Information Size (RIS) for a two-arm superiority trial with a binary
 * outcome, using the standard normal-approximation sample-size formula:
 *
 *   n_per_group = (z_{alpha/2} + z_{beta})² · (p1(1-p1) + p2(1-p2)) / (p1 - p2)²
 *
 * where p2 is the control-arm risk and p1 = p2·(1 - RRR) is the treatment-arm
 * risk implied by the anticipated relative risk reduction. The task formula
 * multiplies by 2 to express the requirement per group symmetrically, so the
 * total is 2·n_per_group.
 *
 * When `iSquared` is supplied the RIS is inflated by the heterogeneity/diversity
 * factor 1/(1 - I²): a heterogeneous body of evidence needs proportionally more
 * information before it can be called conclusive.
 */
export function requiredInformationSize(
  input: RequiredInformationSizeInput
): RequiredInformationSizeResult {
  const { controlRisk, relativeRiskReduction, alpha, power, iSquared } =
    RequiredInformationSizeSchema.parse(input);

  const zAlpha = normalQuantile(1 - alpha / 2);
  const zBeta = normalQuantile(power);

  const p2 = controlRisk;
  const p1 = controlRisk * (1 - relativeRiskReduction);
  const delta = p1 - p2;

  const variancePart = p1 * (1 - p1) + p2 * (1 - p2);
  const base = ((zAlpha + zBeta) ** 2 * variancePart) / delta ** 2;

  // The task formula: n = base · 2 (per group), total = 2 · perGroup.
  let risPerGroup = base * 2;

  const diversityAdjusted = typeof iSquared === "number" && iSquared > 0;
  if (diversityAdjusted) {
    risPerGroup = risPerGroup / (1 - (iSquared as number));
  }

  const risTotal = risPerGroup * 2;

  return {
    risPerGroup: Math.ceil(risPerGroup),
    risTotal: Math.ceil(risTotal),
    p1,
    p2,
    diversityAdjusted,
  };
}

// ---------------------------------------------------------------------------
// 2. O'Brien–Fleming alpha-spending boundary
// ---------------------------------------------------------------------------

/**
 * Two-sided O'Brien–Fleming alpha-spending Z boundary at information fraction t,
 * using the Lan–DeMets OBF approximation:
 *
 *   Z(t) = z_{alpha/4} / sqrt(t)
 *
 * z_{alpha/4} is the upper alpha/4 normal quantile = Phi⁻¹(1 - alpha/4). The
 * boundary is very large for small t (few data → demand overwhelming evidence)
 * and relaxes toward z_{alpha/4} as t → 1. For the conventional alpha = 0.05
 * this gives z_{0.0125} = Phi⁻¹(0.9875) ≈ 2.2414 at t = 1.
 */
export function obrienFlemingBoundary(
  input: ObrienFlemingBoundaryInput
): ObrienFlemingBoundaryResult {
  const { informationFraction, alpha } = ObrienFlemingBoundarySchema.parse(input);

  const zAlphaQuarter = normalQuantile(1 - alpha / 4);
  const z = zAlphaQuarter / Math.sqrt(informationFraction);

  return { z, informationFraction };
}

// ---------------------------------------------------------------------------
// 3. Trial sequential verdict
// ---------------------------------------------------------------------------

/**
 * Compares the accrued information fraction (accruedN / RIS) and the cumulative
 * Z-statistic of the pooled effect against the O'Brien–Fleming monitoring
 * boundary, returning a discrete, defensible verdict:
 *
 *   - conclusive_benefit        cumulative |Z| crossed the OBF boundary in the
 *                               direction of effect → the evidence is conclusive,
 *                               further trials are unlikely to overturn it.
 *   - conclusive_no_effect      the full RIS has accrued (t >= 1) yet |Z| never
 *                               reached the (now conventional) boundary → a real
 *                               effect of the anticipated size has been ruled out.
 *   - insufficient_information  neither: not enough information has accrued and
 *                               the boundary has not been crossed → MORE DATA
 *                               NEEDED before any conclusion.
 *
 * Reuses obrienFlemingBoundary (and thus normalQuantile) for the boundary; no
 * LLM, fully deterministic.
 */
export function trialSequentialVerdict(
  input: TrialSequentialVerdictInput
): TrialSequentialVerdictResult {
  const { accruedN, ris, cumulativeZ, alpha } = TrialSequentialVerdictSchema.parse(input);

  // Information fraction is capped at 1: you cannot have monitored more than the
  // required information's worth of evidence for boundary purposes.
  const rawFraction = accruedN / ris;
  const informationFraction = Math.min(rawFraction, 1);

  const { z: boundaryZ } = obrienFlemingBoundary({ informationFraction, alpha });
  const absZ = Math.abs(cumulativeZ);
  const crossedBenefit = absZ >= boundaryZ;

  const risReached = rawFraction >= 1;
  // "Futility"/no-effect can only be called once the full RIS has accrued and the
  // effect boundary was still not crossed. Before that, absence of crossing is
  // simply insufficient information, not evidence of no effect.
  const crossedNoEffect = risReached && !crossedBenefit;

  let verdict: TrialSequentialDecision;
  let rationale: string;

  const pct = (informationFraction * 100).toFixed(1);
  const zStr = cumulativeZ.toFixed(3);
  const bStr = boundaryZ.toFixed(3);

  if (crossedBenefit) {
    const direction = cumulativeZ >= 0 ? "favoring treatment" : "favoring control";
    verdict = "conclusive_benefit";
    rationale =
      `Cumulative Z = ${zStr} (${direction}) crossed the O'Brien–Fleming monitoring ` +
      `boundary ±${bStr} at ${pct}% of the required information size. The pooled ` +
      `evidence is conclusive at alpha = ${alpha}; further trials are unlikely to ` +
      `overturn this result.`;
  } else if (crossedNoEffect) {
    verdict = "conclusive_no_effect";
    rationale =
      `The full required information size has accrued (${pct}% ) yet cumulative ` +
      `Z = ${zStr} never reached the boundary ±${bStr}. An effect of the ` +
      `anticipated magnitude can be excluded at alpha = ${alpha}; the evidence is ` +
      `conclusively negative for that effect size.`;
  } else {
    verdict = "insufficient_information";
    rationale =
      `Only ${pct}% of the required information size has accrued and cumulative ` +
      `Z = ${zStr} has not crossed the O'Brien–Fleming boundary ±${bStr}. The ` +
      `pooled evidence is not yet conclusive — more data are needed before a ` +
      `benefit or no-effect conclusion can be drawn.`;
  }

  return {
    verdict,
    informationFraction,
    boundaryZ,
    cumulativeZ,
    crossedBenefit,
    crossedNoEffect,
    rationale,
  };
}
