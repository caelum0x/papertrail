// Deterministic meta-regression: regress study-level log-effects on a single
// study-level moderator (dose, baseline risk, publication year, ...) to explain
// heterogeneity.
//
// This is the layer a generic LLM claim-checker structurally cannot reproduce:
// rather than asking a model whether "the effect depends on dose", it independently
// FITS yi ~ b0 + b1*x by inverse-variance weighted least squares over the
// registered/reported effect estimates — the exact closed form implemented by
// reference tools (metafor's `rma(..., mods = ~x)`). No LLM is in the numeric loop;
// every number is reproducible from the inputs.
//
// Weights are 1 / (vi + tau^2), where tau^2 is a DerSimonian–Laird-style residual
// between-study variance estimated by the method of moments from the residual Q of
// the WLS fit (a "mixed-effects" / random-effects meta-regression). We estimate
// tau^2 once from an initial fixed-effect (tau^2 = 0) WLS fit and refit with the
// inflated weights — the standard two-step moment estimator. Set tau^2 = 0 (a
// fixed-effect meta-regression) by passing { residualHeterogeneity: false }.
//
// A significant slope (slopePValue < 0.05) means the moderator explains variation
// in the effect across studies. Pure: every function returns fresh objects and
// never mutates its inputs.

import { z } from "zod";
import { studentTCdf, chiSquareSurvival } from "./stats/distributions";

// One study on the log scale plus its moderator value. Structurally the subset of
// lib/metaAnalysis.ts's StudyEffect (label, yi, vi) that the regression needs, with
// the study-level moderator x. Defined locally so callers can regress any
// (yi, vi, x) set without the full pooling pipeline.
export interface MetaRegressionPoint {
  label: string;
  yi: number; // log effect
  vi: number; // variance of the log effect (must be > 0)
  x: number; // study-level moderator (dose, baseline risk, year, ...)
}

export interface MetaRegressionResult {
  k: number; // number of studies regressed
  intercept: number; // b0
  slope: number; // b1 — effect of a one-unit change in the moderator on log effect
  interceptSe: number; // SE(b0)
  slopeSe: number; // SE(b1)
  slopeZ: number; // b1 / SE(b1) (Wald statistic)
  slopePValue: number; // two-sided p for slope != 0 (t_{k-2})
  residualQ: number; // Cochran's Q for residual heterogeneity (weighted RSS)
  residualDf: number; // k - 2 (k studies, 2 fitted parameters)
  residualPValue: number; // upper-tail chi-square p for residualQ
  tauSquared: number; // residual between-study variance (DL moment estimator; 0 if disabled)
  rSquaredAnalog: number; // proportion of between-study variance explained (0..1)
  // predict(x): fitted log effect b0 + b1*x at a moderator value x.
  predict: (x: number) => number;
}

export interface MetaRegressionOptions {
  // When true (default) a DerSimonian–Laird-style residual tau^2 is estimated by
  // the method of moments and folded into the weights (mixed-effects
  // meta-regression). When false, a fixed-effect meta-regression (tau^2 = 0).
  residualHeterogeneity?: boolean;
}

const MIN_STUDIES = 3;

function isUsable(p: MetaRegressionPoint): boolean {
  return (
    Number.isFinite(p.yi) &&
    Number.isFinite(p.vi) &&
    p.vi > 0 &&
    Number.isFinite(p.x)
  );
}

// Weighted least squares of yi ~ b0 + b1*x with per-study weights w. Returns the
// coefficients, their variances (from the weighted normal equations), the
// weighted residual sum of squares (which is Cochran's Q when w = 1/vi), and the
// weight moments needed by the DL tau^2 estimator. Pure.
function weightedFit(
  y: readonly number[],
  x: readonly number[],
  w: readonly number[]
): {
  b0: number;
  b1: number;
  varB0: number;
  varB1: number;
  rss: number;
  sxxW: number;
} {
  const k = y.length;
  let sw = 0;
  let swx = 0;
  let swy = 0;
  let swxx = 0;
  let swxy = 0;
  for (let i = 0; i < k; i++) {
    sw += w[i];
    swx += w[i] * x[i];
    swy += w[i] * y[i];
    swxx += w[i] * x[i] * x[i];
    swxy += w[i] * x[i] * y[i];
  }

  // Weighted centered sum of squares/products (numerically stable normal equations).
  const meanXw = swx / sw;
  const sxxW = swxx - sw * meanXw * meanXw; // = sum w*(x - xbar_w)^2
  const sxyW = swxy - swx * (swy / sw); // = sum w*(x - xbar_w)*(y - ybar_w)

  const b1 = sxyW / sxxW;
  const b0 = (swy - b1 * swx) / sw;

  // Variances from the inverse of the weighted design's X'WX. For a mixed model
  // where the weights already equal the inverse total variance, these are the
  // model-based SEs used by metafor.
  const varB1 = 1 / sxxW;
  const varB0 = 1 / sw + (meanXw * meanXw) / sxxW;

  // Weighted residual sum of squares (Cochran's residual Q when w = 1/vi).
  let rss = 0;
  for (let i = 0; i < k; i++) {
    const resid = y[i] - (b0 + b1 * x[i]);
    rss += w[i] * resid * resid;
  }

  return { b0, b1, varB0, varB1, rss, sxxW };
}

/**
 * Fit a deterministic meta-regression yi ~ b0 + b1*x by inverse-variance weighted
 * least squares over study-level effect estimates and a single moderator x.
 *
 * By default (residualHeterogeneity: true) a DerSimonian–Laird residual tau^2 is
 * estimated by the method of moments from the fixed-effect fit's residual Q and
 * folded into the weights (weight_i = 1 / (vi + tau^2)), then the model is refit —
 * a mixed-effects meta-regression, matching metafor's `rma(..., mods = ~x)`. A
 * significant slope (slopePValue < 0.05) means the moderator explains variation in
 * the effect across studies.
 *
 * Requires at least three studies with >= 2 DISTINCT moderator values (df = k - 2 >= 1
 * and a non-degenerate x). Returns null otherwise, so the caller honestly reports
 * that the regression could not be run rather than a spurious slope. Pure: returns
 * fresh objects and never mutates its inputs.
 */
export function metaRegression(
  points: readonly MetaRegressionPoint[],
  options?: MetaRegressionOptions
): MetaRegressionResult | null {
  const usable = points.filter(isUsable);
  const k = usable.length;
  if (k < MIN_STUDIES) return null;

  // Require at least 2 distinct moderator values — otherwise the slope is
  // undefined (all x identical → zero spread on the regressor).
  const distinctX = new Set(usable.map((p) => p.x)).size;
  if (distinctX < 2) return null;

  const y = usable.map((p) => p.yi);
  const x = usable.map((p) => p.x);
  const vi = usable.map((p) => p.vi);
  const df = k - 2;

  // Step 1: fixed-effect WLS (weights = 1/vi). Its residual RSS is the residual Q.
  const feWeights = vi.map((v) => 1 / v);
  const fe = weightedFit(y, x, feWeights);
  const residualQfixed = fe.rss;

  // Step 2: DerSimonian–Laird moment estimator of residual tau^2 from the
  // fixed-effect residual Q. The trace term c = sum(w) - trace((X'WX)^-1 X'W^2 X)
  // reduces, for a two-column design, to sum(w) - [ sum(w^2)/sum(w) +
  // sum(w^2*(x - xbar_w)^2) / Sxx_w ]. tau^2 = max(0, (Q - df) / c).
  const wantTau = options?.residualHeterogeneity ?? true;
  let tauSquared = 0;
  if (wantTau && df > 0) {
    let sumW = 0;
    let sumW2 = 0;
    let sumW2xc2 = 0;
    const meanXwFe =
      feWeights.reduce((a, w, i) => a + w * x[i], 0) /
      feWeights.reduce((a, w) => a + w, 0);
    for (let i = 0; i < k; i++) {
      const w = feWeights[i];
      sumW += w;
      sumW2 += w * w;
      sumW2xc2 += w * w * (x[i] - meanXwFe) * (x[i] - meanXwFe);
    }
    const c = sumW - (sumW2 / sumW + sumW2xc2 / fe.sxxW);
    tauSquared = c > 0 ? Math.max(0, (residualQfixed - df) / c) : 0;
  }

  // Step 3: refit with inflated weights 1 / (vi + tau^2) (identical to step 1 when
  // tau^2 = 0). This is the reported mixed-effects fit.
  const weights = vi.map((v) => 1 / (v + tauSquared));
  const fit = weightedFit(y, x, weights);

  const slopeSe = Math.sqrt(fit.varB1);
  const interceptSe = Math.sqrt(fit.varB0);
  const slopeZ = fit.b1 / slopeSe;

  // Two-sided slope p-value from the Student-t CDF (t_{k-2}) — matches metafor's
  // default test="t" for meta-regression coefficients (more honest than a normal
  // approximation at small k). Guard the degenerate zero-SE case.
  let slopePValue: number;
  if (slopeSe === 0 || !Number.isFinite(slopeSe)) {
    slopePValue = fit.b1 === 0 ? 1 : 0;
  } else {
    slopePValue = 2 * (1 - studentTCdf(Math.abs(slopeZ), df));
  }

  // Residual heterogeneity Q (Q_E): the fixed-effect weighted RSS, tested against
  // chi-square_{k-2}. Reported on the fixed-effect scale so it is comparable to the
  // total heterogeneity (a mixed-model refit already absorbs tau^2 into weights).
  const residualQ = residualQfixed;
  const residualPValue = chiSquareSurvival(residualQ, df);

  // R^2 analog (metafor's R^2): proportion of the TOTAL between-study variance
  // (tau^2 of an intercept-only model) explained by the moderator. Computed from
  // the moment estimator: R^2 = 1 - tau^2_resid / tau^2_total, clamped to [0, 1].
  const rSquaredAnalog = rSquaredFromTau(y, vi, tauSquared);

  const b0 = fit.b0;
  const b1 = fit.b1;

  return {
    k,
    intercept: b0,
    slope: b1,
    interceptSe,
    slopeSe,
    slopeZ,
    slopePValue,
    residualQ,
    residualDf: df,
    residualPValue,
    tauSquared,
    rSquaredAnalog,
    predict: (xv: number) => b0 + b1 * xv,
  };
}

// R^2 analog = 1 - tau^2_residual / tau^2_total, where tau^2_total is the
// DerSimonian–Laird between-study variance of the intercept-only (no-moderator)
// model over the same studies. Clamped to [0, 1]; 0 when the total is 0 (no
// heterogeneity to explain). Pure.
function rSquaredFromTau(
  y: readonly number[],
  vi: readonly number[],
  tauResidual: number
): number {
  const k = y.length;
  const w = vi.map((v) => 1 / v);
  const sumW = w.reduce((a, wi) => a + wi, 0);
  const sumW2 = w.reduce((a, wi) => a + wi * wi, 0);
  const wMean = y.reduce((a, yi, i) => a + w[i] * yi, 0) / sumW;
  const qTotal = y.reduce((a, yi, i) => a + w[i] * (yi - wMean) * (yi - wMean), 0);
  const dfTotal = k - 1;
  const c = sumW - sumW2 / sumW;
  const tauTotal = c > 0 ? Math.max(0, (qTotal - dfTotal) / c) : 0;
  if (tauTotal <= 0) return 0;
  const r2 = 1 - tauResidual / tauTotal;
  return Math.min(1, Math.max(0, r2));
}

/**
 * Fitted log effect b0 + b1*x at a moderator value, from a computed result.
 * Convenience wrapper over `result.predict` for callers that hold the result
 * object rather than the closure. Pure.
 */
export function predict(result: MetaRegressionResult, x: number): number {
  return result.predict(x);
}

// ---------------------------------------------------------------------------
// Boundary validation (Zod). Callers at the API boundary parse untrusted input
// with this schema before handing clean numbers to `metaRegression`.
// ---------------------------------------------------------------------------

const MetaRegressionPointSchema = z.object({
  label: z.string().min(1).max(200),
  yi: z.number().finite(),
  vi: z.number().positive(),
  x: z.number().finite(),
});

export const MetaRegressionRequestSchema = z.object({
  // Optional claim text — accepted for parity with the other public engines and so
  // the moderator effect can be reported next to a specific claim. Never logged.
  claim: z.string().min(1).max(2000).optional(),
  moderator: z.string().min(1).max(120).optional(),
  points: z.array(MetaRegressionPointSchema).min(MIN_STUDIES).max(200),
  residualHeterogeneity: z.boolean().optional(),
});

export type MetaRegressionRequest = z.infer<typeof MetaRegressionRequestSchema>;
export type MetaRegressionPointInput = z.infer<typeof MetaRegressionPointSchema>;
