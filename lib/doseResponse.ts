// Deterministic dose-response meta-analysis: estimate the LINEAR TREND of effect
// across dose levels — "does more drug mean more effect?" — from a set of
// dose-stratified effect estimates measured against a COMMON reference.
//
// This is a capability a single-comparison claim-checker structurally cannot
// reproduce: a per-comparison checker can verify "5 mg reduced events by 20%",
// but it cannot answer whether the effect grows with dose across 5/10/20 mg. We
// fit a weighted linear trend yi ~ b*dose by inverse-variance weighted least
// squares (the exact closed form implemented by reference tools such as metafor's
// `rma(..., mods = ~dose)` / the standard trend test in a dose-response
// meta-analysis) and test the slope against zero. NO LLM is in the numeric loop;
// every number is reproducible from the inputs.
//
// SCALE CONTRACT: `yi` is the effect of a dose vs the COMMON reference on the
// scale the caller intends the trend to be linear on. For RATIO measures
// (RR/HR/OR) this MUST be the natural-LOG effect (log RR etc.), supplied by the
// caller — this module never takes logs itself. `vi` is the variance of `yi` on
// that same scale. A positive slope then means "higher dose → larger log effect".
//
// Pure: every function returns fresh objects and never mutates its inputs.

import { z } from "zod";
import { studentTCdf, chiSquareSurvival, studentTInverse } from "./stats/distributions";

// One dose level's pooled/reported effect vs the common reference, on the caller's
// chosen (log, for ratios) scale, plus its variance.
export interface DosePoint {
  label: string;
  dose: number; // dose level (mg, or any consistent unit)
  yi: number; // effect vs common reference on the trend scale (log scale for ratios)
  vi: number; // variance of yi (must be > 0)
}

// Fitted trend value at one observed dose, with a 95% CI derived from the full
// (intercept, slope) covariance of the weighted fit.
export interface PerDoseEffect {
  dose: number;
  fitted: number;
  ciLower: number;
  ciUpper: number;
}

export type TrendDirection = "increasing" | "decreasing" | "no_trend";

export interface DoseResponseResult {
  k: number; // number of dose points used
  distinctDoses: number;
  slopePerUnitDose: number; // change in effect per one-unit increase in dose
  slopeSe: number;
  slopeZ: number; // slope / slopeSe (Wald statistic)
  slopePValue: number; // two-sided p for slope != 0 (Student-t, df = k - 2)
  intercept: number; // fitted effect at dose = 0 (extrapolated), on the trend scale
  perDoseEffect: PerDoseEffect[]; // fitted line + CI at each observed dose
  trend: TrendDirection; // by slope sign + significance at 0.05
  residualQ: number; // Cochran's Q for lack-of-fit around the line (weighted RSS)
  residualDf: number; // k - 2
  residualPValue: number; // upper-tail chi-square p for residualQ
}

const MIN_POINTS = 3;
const MIN_DISTINCT_DOSES = 2;
const ALPHA = 0.05;

function isUsable(p: DosePoint): boolean {
  return (
    Number.isFinite(p.dose) &&
    Number.isFinite(p.yi) &&
    Number.isFinite(p.vi) &&
    p.vi > 0
  );
}

/**
 * Fit the deterministic dose-response linear trend yi ~ b*dose by inverse-variance
 * weighted least squares over dose-stratified effect estimates (each measured vs a
 * COMMON reference). Dose is centered internally for numerical stability; the
 * reported slope is invariant to that centering, and the intercept is reported on
 * the original (uncentered) dose scale so `intercept + slope*dose` reconstructs the
 * fitted line.
 *
 * The slope is tested against zero with a two-sided Student-t test (df = k - 2),
 * matching the trend test used in dose-response meta-analysis. `trend` is
 * 'increasing'/'decreasing' only when the slope is significant at 0.05, otherwise
 * 'no_trend' — an honest "no dose-response detected" rather than a spurious sign.
 *
 * Requires k >= 3 usable points with >= 2 DISTINCT dose levels (df = k - 2 >= 1 and
 * a non-degenerate dose regressor); returns null otherwise. Ratio effects are
 * supplied on the LOG scale by the caller — see the file header SCALE CONTRACT.
 * Pure: returns fresh objects and never mutates its inputs.
 */
export function doseResponseTrend(
  points: readonly DosePoint[]
): DoseResponseResult | null {
  const usable = points.filter(isUsable);
  const k = usable.length;
  if (k < MIN_POINTS) return null;

  const distinctDoses = new Set(usable.map((p) => p.dose)).size;
  if (distinctDoses < MIN_DISTINCT_DOSES) return null;

  const df = k - 2;

  // Inverse-variance (fixed-effect) weights.
  const w = usable.map((p) => 1 / p.vi);
  const sumW = w.reduce((a, wi) => a + wi, 0);

  // Center dose on its weighted mean for a numerically stable, uncorrelated fit:
  // in centered coordinates the slope and (centered) intercept are orthogonal, so
  // Var(slope) = 1 / Sxx_w exactly.
  const doseBar = usable.reduce((a, p, i) => a + w[i] * p.dose, 0) / sumW;
  const xc = usable.map((p) => p.dose - doseBar);

  // Weighted centered sums of squares/products.
  const sxxW = usable.reduce((a, _p, i) => a + w[i] * xc[i] * xc[i], 0);
  const yBar = usable.reduce((a, p, i) => a + w[i] * p.yi, 0) / sumW;
  const sxyW = usable.reduce((a, p, i) => a + w[i] * xc[i] * (p.yi - yBar), 0);

  // Slope is invariant to centering. Centered intercept is the weighted mean yBar.
  const slope = sxyW / sxxW;
  const interceptCentered = yBar; // fitted effect AT the weighted-mean dose
  // Back out the intercept on the original dose scale: fitted = a0 + slope*dose.
  const intercept = interceptCentered - slope * doseBar;

  // Model-based variances from the inverse of the weighted normal equations. In
  // centered coordinates X'WX is diagonal, so these are exact closed forms.
  const varSlope = 1 / sxxW;
  const varInterceptCentered = 1 / sumW;
  const slopeSe = Math.sqrt(varSlope);
  const slopeZ = slope / slopeSe;

  // Two-sided slope p-value from the Student-t CDF (t_{k-2}) — the trend test.
  // Guard the degenerate zero-SE case (only possible when Sxx_w is non-finite).
  let slopePValue: number;
  if (slopeSe === 0 || !Number.isFinite(slopeSe)) {
    slopePValue = slope === 0 ? 1 : 0;
  } else {
    slopePValue = 2 * (1 - studentTCdf(Math.abs(slopeZ), df));
  }

  // Weighted residual sum of squares = Cochran's Q for lack-of-fit around the line.
  const residualQ = usable.reduce((a, p, i) => {
    const resid = p.yi - (interceptCentered + slope * xc[i]);
    return a + w[i] * resid * resid;
  }, 0);
  const residualPValue = chiSquareSurvival(residualQ, df);

  // Per-dose fitted CI. In centered coordinates slope and intercept are
  // uncorrelated, so Var(fitted at dose d) = Var(a0) + (d - doseBar)^2 * Var(slope).
  // Use the same Student-t critical value as the slope test (df = k - 2).
  const tCrit = studentTInverse(1 - ALPHA / 2, df);
  const perDoseEffect: PerDoseEffect[] = uniqueSortedDoses(usable).map((d) => {
    const c = d - doseBar;
    const fitted = interceptCentered + slope * c;
    const seFit = Math.sqrt(varInterceptCentered + c * c * varSlope);
    const half = tCrit * seFit;
    return { dose: d, fitted, ciLower: fitted - half, ciUpper: fitted + half };
  });

  const trend = classifyTrend(slope, slopePValue);

  return {
    k,
    distinctDoses,
    slopePerUnitDose: slope,
    slopeSe,
    slopeZ,
    slopePValue,
    intercept,
    perDoseEffect,
    trend,
    residualQ,
    residualDf: df,
    residualPValue,
  };
}

// Distinct observed doses in ascending order, so the fitted line is reported
// monotonically in dose regardless of input order. Pure.
function uniqueSortedDoses(points: readonly DosePoint[]): number[] {
  return Array.from(new Set(points.map((p) => p.dose))).sort((a, b) => a - b);
}

// 'increasing'/'decreasing' only when the slope is significant at 0.05; otherwise
// 'no_trend'. Keeps the direction honest: an insignificant slope is reported as no
// detected dose-response rather than by its (noisy) sign. Pure.
function classifyTrend(slope: number, slopePValue: number): TrendDirection {
  if (slopePValue >= ALPHA || slope === 0) return "no_trend";
  return slope > 0 ? "increasing" : "decreasing";
}

// ---------------------------------------------------------------------------
// Boundary validation (Zod). Callers at the API boundary parse untrusted input
// with this schema before handing clean numbers to `doseResponseTrend`.
// ---------------------------------------------------------------------------

const DosePointSchema = z.object({
  label: z.string().min(1).max(200),
  dose: z.number().finite(),
  yi: z.number().finite(),
  vi: z.number().positive(),
});

export const DoseResponseRequestSchema = z.object({
  // Optional claim text — accepted for parity with the other public engines and so
  // the dose-response trend can be reported next to a specific claim. Never logged.
  claim: z.string().min(1).max(2000).optional(),
  // Optional unit label for the dose axis (e.g. "mg/day"), echoed back for display.
  doseUnit: z.string().min(1).max(60).optional(),
  points: z.array(DosePointSchema).min(MIN_POINTS).max(200),
});

export type DoseResponseRequest = z.infer<typeof DoseResponseRequestSchema>;
export type DosePointInput = z.infer<typeof DosePointSchema>;
