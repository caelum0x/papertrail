// Deterministic meta-analysis for CONTINUOUS outcomes (mean differences).
//
// Many trials report continuous endpoints — change in blood pressure, pain score,
// HbA1c, quality-of-life scale — not events. The ratio engine (lib/metaAnalysis.ts)
// pools RR/HR/OR on the log scale around a null of 1; that math is structurally
// wrong for a difference, whose null is 0 and which lives on the raw (not log)
// scale. This file is the continuous-outcome counterpart.
//
// Two effect measures are supported:
//   - MD  (mean difference): the raw difference in means, on the outcome's own
//     units. Poolable only across trials that used the SAME instrument/units.
//   - SMD (standardized mean difference, Hedges' g): the difference in SD units,
//     with the small-sample bias correction J. Poolable across trials that used
//     DIFFERENT instruments for the same construct.
//
// As with the ratio engine, NO LLM is in the numeric loop: every number is a pure
// closed-form computation reproducible from the arm summaries (meanT, sdT, nT,
// meanC, sdC, nC), using the exact forms metafor/RevMan implement. Pure and
// immutable — never mutates its inputs. Reuses ciZ / chiSquareSurvival /
// studentTInverse from lib/stats/distributions rather than reimplementing them.

import { z } from "zod";
import { ciZ, chiSquareSurvival, studentTInverse } from "./stats/distributions";

export type ContinuousMeasure = "MD" | "SMD";

// One two-arm continuous study: treatment (T) and control (C) arm summaries.
// meanT/meanC are the outcome means (or mean changes); sdT/sdC their standard
// deviations; nT/nC the arm sample sizes.
export interface ContinuousStudyInput {
  label: string;
  meanT: number;
  sdT: number;
  nT: number;
  meanC: number;
  sdC: number;
  nC: number;
}

// Mean-difference effect for one study (raw units).
export interface MeanDifferenceEffect {
  md: number;
  se: number;
  variance: number;
  ciLower: number;
  ciUpper: number;
}

// Hedges' g (bias-corrected SMD) effect for one study (SD units).
export interface HedgesGEffect {
  g: number;
  se: number;
  variance: number;
  ciLower: number;
  ciUpper: number;
}

// A study after standardization to the chosen difference scale, with its weights.
export interface ContinuousStudyEffect {
  label: string;
  yi: number; // effect on the difference scale (MD units, or g in SD units)
  vi: number; // variance of yi
  effect: number; // rounded yi for display
  ciLower: number;
  ciUpper: number;
  weightFixedPct: number;
  weightRandomPct: number;
}

export interface ContinuousPooledEstimate {
  model: "fixed" | "random";
  point: number; // pooled difference (null of 0, NOT 1)
  ciLower: number;
  ciUpper: number;
  se: number;
  significant: boolean; // 95% CI excludes the null of 0
}

export interface ContinuousHeterogeneity {
  q: number;
  df: number;
  pValue: number;
  iSquared: number;
  tauSquared: number;
  hSquared: number;
}

export interface ContinuousMetaResult {
  measure: ContinuousMeasure;
  k: number;
  studies: ContinuousStudyEffect[];
  fixed: ContinuousPooledEstimate;
  random: ContinuousPooledEstimate;
  heterogeneity: ContinuousHeterogeneity;
  // 95% prediction interval for a new study's true difference (random effects,
  // t_{k-2}); null when k < 3.
  predictionInterval: { lower: number; upper: number } | null;
  skipped: { label: string; reason: string }[];
}

const DEFAULT_CI_PCT = 95;

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// ---------------------------------------------------------------------------
// Zod schema (local to this engine). Arm SDs must be strictly positive and arm
// sizes at least 2 (a variance needs df >= 1 per arm). Validated at the API
// boundary before anything numeric runs.
// ---------------------------------------------------------------------------
export const ContinuousStudySchema = z.object({
  label: z.string().trim().min(1).max(200),
  meanT: z.number().finite(),
  sdT: z.number().finite().positive(),
  nT: z.number().int().min(2),
  meanC: z.number().finite(),
  sdC: z.number().finite().positive(),
  nC: z.number().int().min(2),
});
export type ContinuousStudy = z.infer<typeof ContinuousStudySchema>;

export const ContinuousMetaRequestSchema = z.object({
  studies: z.array(ContinuousStudySchema).min(1).max(200),
  measure: z.enum(["MD", "SMD"]).default("MD"),
});
export type ContinuousMetaRequest = z.infer<typeof ContinuousMetaRequestSchema>;

/**
 * Mean difference for one two-arm study. MD = meanT − meanC; the standard error
 * uses the Welch-style (unpooled) variance SE = sqrt(sdT²/nT + sdC²/nC), which
 * does NOT assume equal arm variances. Returns the 95% CI on the raw scale.
 * Pure — does not mutate its input.
 */
export function meanDifference(study: ContinuousStudyInput): MeanDifferenceEffect {
  const md = study.meanT - study.meanC;
  const variance = (study.sdT * study.sdT) / study.nT + (study.sdC * study.sdC) / study.nC;
  const se = Math.sqrt(variance);
  const z = ciZ(DEFAULT_CI_PCT);
  return {
    md,
    se,
    variance,
    ciLower: md - z * se,
    ciUpper: md + z * se,
  };
}

/**
 * Hedges' g (bias-corrected standardized mean difference) for one two-arm study.
 *
 *   pooled SD = sqrt( ((nT−1)sdT² + (nC−1)sdC²) / (nT+nC−2) )
 *   d         = (meanT − meanC) / pooled SD              (Cohen's d)
 *   J         = 1 − 3 / (4·(nT+nC−2) − 1)                (small-sample correction)
 *   g         = J · d
 *   Var(g)    = J² · ( (nT+nC)/(nT·nC) + d² / (2·(nT+nC−2)) )
 *
 * g is comparable across trials that measured the same construct on different
 * instruments. Pure — does not mutate its input.
 */
export function hedgesG(study: ContinuousStudyInput): HedgesGEffect {
  const dfPooled = study.nT + study.nC - 2;
  const pooledVar =
    ((study.nT - 1) * study.sdT * study.sdT + (study.nC - 1) * study.sdC * study.sdC) / dfPooled;
  const pooledSd = Math.sqrt(pooledVar);
  const d = (study.meanT - study.meanC) / pooledSd;
  const j = 1 - 3 / (4 * dfPooled - 1);
  const g = j * d;
  // Variance of Hedges' g (Borenstein, Introduction to Meta-Analysis, Eq. 4.20–4.24; Cochrane
  // Handbook §6.5.1.3): Var(g) = J²·[ (nT+nC)/(nT·nC) + d²/(2·(nT+nC)) ]. The second-term
  // denominator is 2·N (total sample), NOT 2·(N−2) — the latter slightly over-inflates the
  // variance for small, large-effect studies.
  const nTotal = study.nT + study.nC;
  const variance =
    j * j * (nTotal / (study.nT * study.nC) + (d * d) / (2 * nTotal));
  const se = Math.sqrt(variance);
  const z = ciZ(DEFAULT_CI_PCT);
  return {
    g,
    se,
    variance,
    ciLower: g - z * se,
    ciUpper: g + z * se,
  };
}

// Standardize one input study to (yi, vi) on the chosen difference scale, or a
// reason string when it cannot be used.
function toDifferenceEffect(
  input: ContinuousStudyInput,
  measure: ContinuousMeasure
): { yi: number; vi: number; ciLower: number; ciUpper: number } | { reason: string } {
  if (input.sdT <= 0 || input.sdC <= 0) {
    return { reason: "Arm standard deviations must be positive." };
  }
  if (input.nT < 2 || input.nC < 2) {
    return { reason: "Each arm needs at least two participants." };
  }
  if (measure === "MD") {
    const e = meanDifference(input);
    return { yi: e.md, vi: e.variance, ciLower: e.ciLower, ciUpper: e.ciUpper };
  }
  const e = hedgesG(input);
  return { yi: e.g, vi: e.variance, ciLower: e.ciLower, ciUpper: e.ciUpper };
}

// Inverse-variance pool on the difference scale (null of 0). tauSquared = 0 gives
// the fixed-effect pool. Identical shape to lib/metaAnalysis.ts pool(), but there
// is no log transform because a difference already lives on the additive scale.
function pool(
  studies: { yi: number; vi: number }[],
  tauSquared: number
): { point: number; se: number; weights: number[] } {
  const weights = studies.map((s) => 1 / (s.vi + tauSquared));
  const sumW = weights.reduce((acc, w) => acc + w, 0);
  const sumWy = studies.reduce((acc, s, i) => acc + weights[i] * s.yi, 0);
  const point = sumWy / sumW;
  const se = Math.sqrt(1 / sumW);
  return { point, se, weights };
}

function estimate(
  point: number,
  se: number,
  model: "fixed" | "random"
): ContinuousPooledEstimate {
  const z = ciZ(DEFAULT_CI_PCT);
  const ciLower = point - z * se;
  const ciUpper = point + z * se;
  return {
    model,
    point: round(point, 4),
    ciLower: round(ciLower, 4),
    ciUpper: round(ciUpper, 4),
    se,
    // Null of 0 for a difference: significant iff the CI does not straddle 0.
    significant: ciUpper < 0 || ciLower > 0,
  };
}

/**
 * Pool continuous-outcome studies into a fixed-effect and random-effects
 * meta-analysis on the mean-difference (MD) or Hedges'-g (SMD) scale.
 *
 * Method: inverse-variance weighting (fixed effect) and DerSimonian–Laird
 * between-study variance (random effects) — the SAME closed forms as the ratio
 * engine, but around a null of 0 on the additive scale rather than 1 on the log
 * scale. Studies with a non-positive SD or an arm size below 2 are dropped into
 * `skipped` with a reason. Returns null when fewer than two usable studies remain
 * (a "meta-analysis" of one study is just that study). Pure — no input mutation.
 */
export function poolContinuous(
  inputs: readonly ContinuousStudyInput[],
  options: { measure: ContinuousMeasure }
): ContinuousMetaResult | null {
  if (inputs.length === 0) return null;

  const measure = options.measure;
  const skipped: { label: string; reason: string }[] = [];
  const studies: ContinuousStudyEffect[] = [];
  const raw: { yi: number; vi: number }[] = [];

  for (const input of inputs) {
    const std = toDifferenceEffect(input, measure);
    if ("reason" in std) {
      skipped.push({ label: input.label, reason: std.reason });
      continue;
    }
    if (std.vi <= 0 || !Number.isFinite(std.vi) || !Number.isFinite(std.yi)) {
      skipped.push({ label: input.label, reason: "Degenerate variance (zero-width effect)." });
      continue;
    }
    raw.push({ yi: std.yi, vi: std.vi });
    studies.push({
      label: input.label,
      yi: std.yi,
      vi: std.vi,
      effect: round(std.yi, 4),
      ciLower: round(std.ciLower, 4),
      ciUpper: round(std.ciUpper, 4),
      weightFixedPct: 0,
      weightRandomPct: 0,
    });
  }

  const k = raw.length;
  if (k < 2) return null;

  // Fixed-effect pool (tau² = 0).
  const fe = pool(raw, 0);

  // Cochran's Q and DerSimonian–Laird tau².
  const q = raw.reduce((acc, s, i) => acc + fe.weights[i] * (s.yi - fe.point) ** 2, 0);
  const df = k - 1;
  const sumW = fe.weights.reduce((a, w) => a + w, 0);
  const sumW2 = fe.weights.reduce((a, w) => a + w * w, 0);
  const c = sumW - sumW2 / sumW; // DL scaling constant
  const tauSquared = c > 0 ? Math.max(0, (q - df) / c) : 0;
  const iSquared = q > df ? ((q - df) / q) * 100 : 0;
  const hSquared = q / df;

  // Random-effects pool.
  const re = pool(raw, tauSquared);

  // Per-study weight percentages.
  const sumWfixed = fe.weights.reduce((a, w) => a + w, 0);
  const sumWrandom = re.weights.reduce((a, w) => a + w, 0);
  studies.forEach((s, i) => {
    s.weightFixedPct = round((fe.weights[i] / sumWfixed) * 100, 1);
    s.weightRandomPct = round((re.weights[i] / sumWrandom) * 100, 1);
  });

  // 95% prediction interval (random effects, t_{k-2}); undefined for k < 3.
  let predictionInterval: { lower: number; upper: number } | null = null;
  if (k >= 3) {
    const t = studentTInverse(0.975, k - 2);
    const sePred = Math.sqrt(tauSquared + re.se * re.se);
    predictionInterval = {
      lower: round(re.point - t * sePred, 4),
      upper: round(re.point + t * sePred, 4),
    };
  }

  return {
    measure,
    k,
    studies,
    fixed: estimate(fe.point, fe.se, "fixed"),
    random: estimate(re.point, re.se, "random"),
    heterogeneity: {
      q: round(q, 4),
      df,
      pValue: round(chiSquareSurvival(q, df), 4),
      iSquared: round(iSquared, 1),
      tauSquared: round(tauSquared, 4),
      hSquared: round(hSquared, 3),
    },
    predictionInterval,
    skipped,
  };
}
