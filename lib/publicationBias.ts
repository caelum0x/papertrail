// Deterministic publication-bias / small-study-effects detector for a set of
// meta-analysis study effects (log effect yi + variance vi).
//
// This is the layer a generic LLM claim-checker structurally cannot reproduce:
// rather than asking a model whether "the literature looks cherry-picked", it
// runs Egger's regression test for funnel-plot asymmetry over the registered/
// reported effect estimates — the exact closed form implemented by reference
// tools (metafor's `regtest`, RevMan). No LLM is in the numeric loop; every
// number is reproducible from the inputs.
//
// Egger's test regresses the standard normal deviate of each study
// (SND_i = yi / se_i) on its precision (1 / se_i) by ordinary least squares.
// Under no small-study effects the line passes through the origin, so a
// non-zero INTERCEPT is the signal of funnel-plot asymmetry. The intercept's
// two-sided t-test (df = k - 2) gives a p-value via the Student-t CDF.
//
// This complements lib/metaAnalysis.ts (whose StudyEffect shape it reuses) and
// never mutates its inputs — every function returns fresh objects.

import { studentTCdf } from "./stats/distributions";

// One study on the log scale. Structurally the subset of lib/metaAnalysis.ts's
// StudyEffect that this test needs (label, yi, vi); defined locally so callers
// can run the bias test on any (yi, vi) set without the full pooling pipeline.
export interface StudyEffect {
  label: string;
  yi: number; // log effect
  vi: number; // variance of the log effect
}

export type BiasVerdict =
  | "no_asymmetry"
  | "possible_small_study_effects"
  | "insufficient_studies";

export interface EggersTestResult {
  k: number; // number of studies regressed
  intercept: number; // bias coefficient (0 under symmetry)
  interceptSe: number; // standard error of the intercept
  slope: number; // precision coefficient (the underlying pooled effect)
  t: number; // intercept / interceptSe
  df: number; // k - 2
  pValue: number; // two-sided p for intercept != 0
  asymmetry: boolean; // pValue < ASYMMETRY_ALPHA
}

export interface FunnelStudy {
  label: string;
  effect: number; // yi (log effect)
  se: number; // sqrt(vi)
  standardError: number; // alias of se, for plot-library ergonomics
  deviation: number; // yi - pooledLogEffect (signed distance from the pooled line)
}

export interface FunnelPlotData {
  pooledLogEffect: number;
  studies: FunnelStudy[];
  // Pseudo-95% CI bounds as a function of standard error: the funnel edges,
  // pooledLogEffect +/- 1.96 * se. Sorted widest-SE first so a plot can draw
  // the triangle from the base up. Includes the apex (se = 0) so the funnel
  // closes at the pooled estimate.
  ciBounds: { se: number; lower: number; upper: number }[];
}

// z for a pseudo-95% funnel (two-sided). Constant, not an LLM guess.
const FUNNEL_Z = 1.959963984540054;

// Minimum studies for Egger's regression (need df = k - 2 >= 1).
const MIN_STUDIES = 3;

// Significance threshold for calling the intercept non-zero. Egger's test is
// under-powered, so the conventional relaxed 0.10 is used rather than 0.05.
const ASYMMETRY_ALPHA = 0.1;

function isUsable(s: StudyEffect): boolean {
  return (
    Number.isFinite(s.yi) &&
    Number.isFinite(s.vi) &&
    s.vi > 0
  );
}

/**
 * Egger's regression test for funnel-plot asymmetry (small-study effects).
 *
 * Fits SND_i = intercept + slope * precision_i by ordinary least squares, where
 * SND_i = yi / se_i and precision_i = 1 / se_i (se_i = sqrt(vi)). Returns the
 * intercept, its standard error, the t statistic (intercept / SE), df = k - 2,
 * and the two-sided p-value from the Student-t CDF. A non-zero intercept
 * indicates asymmetry (potential publication bias / small-study effects).
 *
 * Requires at least three usable studies (df >= 1); returns null otherwise, so
 * the caller honestly reports "insufficient studies" rather than a spurious
 * test. Pure: does not mutate its inputs.
 */
export function eggersTest(studies: readonly StudyEffect[]): EggersTestResult | null {
  const usable = studies.filter(isUsable);
  const k = usable.length;
  if (k < MIN_STUDIES) return null;

  const precision = usable.map((s) => 1 / Math.sqrt(s.vi));
  const snd = usable.map((s) => s.yi / Math.sqrt(s.vi));

  const meanX = precision.reduce((a, x) => a + x, 0) / k;
  const meanY = snd.reduce((a, y) => a + y, 0) / k;

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < k; i++) {
    const dx = precision[i] - meanX;
    sxx += dx * dx;
    sxy += dx * (snd[i] - meanY);
  }
  // Degenerate: all studies share the same precision — the regression is
  // undefined (no spread on x). Cannot test asymmetry; defer.
  if (sxx <= 0) return null;

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  // Residual sum of squares and residual variance (s^2), df = k - 2.
  let sse = 0;
  for (let i = 0; i < k; i++) {
    const fitted = intercept + slope * precision[i];
    const resid = snd[i] - fitted;
    sse += resid * resid;
  }
  const df = k - 2;
  const s2 = sse / df;

  // SE of the OLS intercept: sqrt( s^2 * (1/k + meanX^2 / Sxx) ).
  const interceptSe = Math.sqrt(s2 * (1 / k + (meanX * meanX) / sxx));

  // t and two-sided p. Guard the zero-residual case (perfect fit → SE 0): the
  // intercept is either exactly zero (p = 1) or non-zero (p = 0).
  let t: number;
  let pValue: number;
  if (interceptSe === 0 || !Number.isFinite(interceptSe)) {
    t = intercept === 0 ? 0 : intercept > 0 ? Infinity : -Infinity;
    pValue = intercept === 0 ? 1 : 0;
  } else {
    t = intercept / interceptSe;
    pValue = 2 * (1 - studentTCdf(Math.abs(t), df));
  }

  return {
    k,
    intercept,
    interceptSe,
    slope,
    t,
    df,
    pValue,
    asymmetry: pValue < ASYMMETRY_ALPHA,
  };
}

/**
 * Per-study coordinates for a funnel plot plus the pseudo-95% CI funnel edges.
 *
 * Each study contributes { effect: yi, se, standardError, deviation } where
 * deviation = yi - pooledLogEffect (signed horizontal distance from the pooled
 * line). The `ciBounds` are the funnel triangle: pooledLogEffect +/- 1.96*se
 * across the observed SE range down to the apex at se = 0. Pure: returns fresh
 * objects and does not mutate its inputs.
 */
export function funnelPlotData(
  studies: readonly StudyEffect[],
  pooledLogEffect: number
): FunnelPlotData {
  const usable = studies.filter(isUsable);

  const funnelStudies: FunnelStudy[] = usable.map((s) => {
    const se = Math.sqrt(s.vi);
    return {
      label: s.label,
      effect: s.yi,
      se,
      standardError: se,
      deviation: s.yi - pooledLogEffect,
    };
  });

  const ses = funnelStudies.map((s) => s.se);
  const maxSe = ses.length > 0 ? Math.max(...ses) : 0;

  // Widest SE at the base, apex (se = 0) at the top where the funnel closes on
  // the pooled estimate. Immutable: build then sort a copy.
  const boundSes = Array.from(new Set([...ses, 0])).sort((a, b) => b - a);
  const ciBounds = boundSes.map((se) => ({
    se,
    lower: pooledLogEffect - FUNNEL_Z * se,
    upper: pooledLogEffect + FUNNEL_Z * se,
  }));

  return {
    pooledLogEffect,
    studies: funnelStudies,
    ciBounds: ciBounds.length > 0 ? ciBounds : [{ se: maxSe, lower: pooledLogEffect, upper: pooledLogEffect }],
  };
}

// ---------------------------------------------------------------------------
// Trim-and-fill (Duval & Tweedie 2000), L0 estimator.
//
// Ported from metafor's `trimfill.rma.uni` algorithm (the ALGORITHM, not the
// GPL source): estimate the number of studies k0 missing from one side of the
// funnel due to publication bias, mirror them about the pooled effect, and
// recompute a fixed-effect pooled estimate that includes the imputed studies —
// pulling the summary back toward the null. No LLM in the numeric loop; every
// number is reproducible from the (yi, vi) inputs.
//
// The L0 estimator of the number of missing studies is
//     L0 = ( 4 * Tn - n * (n + 1) ) / ( 2 * n - 1 )
// where Tn is the sum of the ranks (by |deviation| from the current pooled
// effect) of the studies on the OVERREPRESENTED side. The trimming iterates:
// re-estimate the pooled effect from the n - k0 innermost studies, re-rank,
// re-estimate k0, until k0 stabilises. Finally k0 studies are imputed by
// reflecting the k0 most extreme observed studies about the trimmed pooled
// effect (same variance vi), and the fixed-effect pool is recomputed over all
// observed + imputed studies.
// ---------------------------------------------------------------------------

export interface ImputedStudy {
  yi: number;
  vi: number;
}

export interface TrimAndFillResult {
  k0Imputed: number; // estimated number of missing studies
  side: "left" | "right" | "none"; // side on which studies were imputed
  adjustedPooledLogEffect: number; // fixed-effect pool over observed + imputed
  adjustedPoint: number; // exp(adjustedPooledLogEffect)
  adjustedCiLower: number; // exp(lower 95% CI on the log scale)
  adjustedCiUpper: number; // exp(upper 95% CI on the log scale)
  imputed: ImputedStudy[]; // the mirrored studies (empty when k0 = 0)
}

const MIN_TRIMFILL_STUDIES = 3;
const TRIMFILL_MAX_ITER = 100;
const TRIMFILL_Z = FUNNEL_Z; // pseudo-95% two-sided z for the adjusted CI

// Inverse-variance fixed-effect pooled log effect over a set of (yi, vi).
// Self-contained (does not import metaAnalysis.ts): weight = 1/vi.
function fixedEffectPool(studies: readonly ImputedStudy[]): {
  pooled: number;
  se: number;
} {
  let sumW = 0;
  let sumWy = 0;
  for (const s of studies) {
    const w = 1 / s.vi;
    sumW += w;
    sumWy += w * s.yi;
  }
  const pooled = sumWy / sumW;
  const se = Math.sqrt(1 / sumW);
  return { pooled, se };
}

// L0 estimator of the number of missing studies given the signed deviations of
// the studies from the current pooled effect. Ranks are assigned by absolute
// deviation (ties averaged); Tn is the rank sum on the dominant (over-
// represented) side. Returns { k0, side } with side = the side that would be
// FILLED (opposite the dominant side), or "none" when k0 rounds to 0.
function estimateK0(
  deviations: readonly number[]
): { k0: number; side: "left" | "right" | "none" } {
  const n = deviations.length;
  if (n === 0) return { k0: 0, side: "none" };

  // Rank by absolute deviation, averaging ties (standard Wilcoxon ranks).
  const order = deviations
    .map((d, i) => ({ abs: Math.abs(d), sign: Math.sign(d), i }))
    .sort((a, b) => a.abs - b.abs);

  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && order[j + 1].abs === order[i].abs) j++;
    // ranks i..j (0-based) share averaged rank ((i+1)+(j+1))/2.
    const avg = (i + 1 + (j + 1)) / 2;
    for (let m = i; m <= j; m++) ranks[m] = avg;
    i = j + 1;
  }

  // Signed rank sum: the sum of ranks carrying a positive sign (right side).
  let rankSumRight = 0;
  let rankSumLeft = 0;
  for (let m = 0; m < n; m++) {
    if (order[m].sign > 0) rankSumRight += ranks[m];
    else if (order[m].sign < 0) rankSumLeft += ranks[m];
  }

  // The dominant side is the one with the larger signed rank sum; the L0 rank
  // statistic Tn is that larger sum. Studies are then filled on the OPPOSITE
  // (underrepresented) side.
  const dominantRight = rankSumRight >= rankSumLeft;
  const Tn = dominantRight ? rankSumRight : rankSumLeft;

  const l0 = (4 * Tn - n * (n + 1)) / (2 * n - 1);
  const k0 = Math.max(0, Math.round(l0));
  if (k0 === 0) return { k0: 0, side: "none" };

  // Fill on the side opposite the dominant one.
  return { k0, side: dominantRight ? "left" : "right" };
}

/**
 * Duval & Tweedie trim-and-fill (L0 estimator) for funnel-plot asymmetry.
 *
 * Estimates the number of studies k0 missing from one side of the funnel,
 * imputes them by mirroring the k0 most extreme observed studies about the
 * trimmed pooled effect, and recomputes the fixed-effect pooled estimate over
 * observed + imputed studies — moving the summary toward the null when bias is
 * present. Returns the imputed count/side, the bias-adjusted pooled log effect
 * with its exp() point estimate and pseudo-95% CI, and the imputed (yi, vi)
 * pairs. When no studies are imputed (k0 = 0), the adjusted estimate equals the
 * ordinary fixed-effect pool and `imputed` is empty.
 *
 * Requires at least three usable studies; returns null otherwise so the caller
 * honestly reports that the adjustment could not be run. Pure: returns fresh
 * objects and does not mutate its inputs.
 *
 * @param studies         Study effects on the log scale (label, yi, vi).
 * @param pooledLogEffect Optional starting pooled log effect; when omitted the
 *                        inverse-variance fixed-effect pool of `studies` is used.
 */
export function trimAndFill(
  studies: readonly StudyEffect[],
  pooledLogEffect?: number
): TrimAndFillResult | null {
  const usable = studies.filter(isUsable);
  const n = usable.length;
  if (n < MIN_TRIMFILL_STUDIES) return null;

  const observed: ImputedStudy[] = usable.map((s) => ({ yi: s.yi, vi: s.vi }));

  // Iterative trimming. At each step: pool the innermost (n - k0) studies about
  // the previous pooled effect, re-rank all n by deviation from that pool,
  // re-estimate k0. Stop when k0 stabilises.
  let mu =
    pooledLogEffect !== undefined && Number.isFinite(pooledLogEffect)
      ? pooledLogEffect
      : fixedEffectPool(observed).pooled;

  let k0 = 0;
  let side: "left" | "right" | "none" = "none";

  for (let iter = 0; iter < TRIMFILL_MAX_ITER; iter++) {
    // Trim the k0 most extreme studies (largest |yi - mu|) from the dominant
    // side, then re-pool from the remaining innermost n - k0.
    const byDist = observed
      .map((s) => ({ s, dist: Math.abs(s.yi - mu) }))
      .sort((a, b) => a.dist - b.dist);
    const trimmed = byDist.slice(0, n - k0).map((x) => x.s);
    const newMu = fixedEffectPool(trimmed).pooled;

    const est = estimateK0(observed.map((s) => s.yi - newMu));

    mu = newMu;
    if (est.k0 === k0) {
      side = est.side;
      break;
    }
    k0 = est.k0;
    side = est.side;
  }

  // Clamp: cannot impute more studies than we observed.
  k0 = Math.min(k0, n);

  // Impute by mirroring the k0 most extreme studies (on the dominant side)
  // about the trimmed pooled effect mu. Reflection: yi* = 2*mu - yi, keep vi.
  const imputed: ImputedStudy[] = [];
  if (k0 > 0 && side !== "none") {
    // Extreme studies are those furthest from mu on the DOMINANT side, which is
    // opposite the fill side. Rank all by distance, take the k0 furthest that
    // lie on the dominant side.
    const dominantSign = side === "left" ? 1 : -1; // dominant is opposite fill
    const candidates = observed
      .filter((s) => Math.sign(s.yi - mu) === dominantSign)
      .sort((a, b) => Math.abs(b.yi - mu) - Math.abs(a.yi - mu))
      .slice(0, k0);
    for (const s of candidates) {
      imputed.push({ yi: 2 * mu - s.yi, vi: s.vi });
    }
  }

  const augmented = [...observed, ...imputed];
  const { pooled: adjustedPooledLogEffect, se } = fixedEffectPool(augmented);
  const adjustedCiLowerLog = adjustedPooledLogEffect - TRIMFILL_Z * se;
  const adjustedCiUpperLog = adjustedPooledLogEffect + TRIMFILL_Z * se;

  return {
    k0Imputed: imputed.length,
    side: imputed.length > 0 ? side : "none",
    adjustedPooledLogEffect,
    adjustedPoint: Math.exp(adjustedPooledLogEffect),
    adjustedCiLower: Math.exp(adjustedCiLowerLog),
    adjustedCiUpper: Math.exp(adjustedCiUpperLog),
    imputed,
  };
}

/**
 * Discrete verdict from an Egger's test result. Returns "insufficient_studies"
 * when the test could not be run (null / fewer than three usable studies),
 * "possible_small_study_effects" when the intercept is significantly non-zero,
 * and "no_asymmetry" otherwise. Pure.
 */
export function interpret(result: EggersTestResult | null): BiasVerdict {
  if (result === null) return "insufficient_studies";
  return result.asymmetry ? "possible_small_study_effects" : "no_asymmetry";
}
