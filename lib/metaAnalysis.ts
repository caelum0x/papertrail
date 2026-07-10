// Deterministic meta-analysis (evidence synthesis) for ratio effect measures.
//
// This is the capability a generic LLM claim-checker structurally cannot do:
// rather than asking a model whether "the literature agrees", it independently
// POOLS the registered/reported effect estimates across N sources into a
// fixed-effect and random-effects summary — with heterogeneity statistics — using
// the exact closed forms implemented by reference tools (metafor / RevMan). No LLM
// is in the numeric loop; every number is reproducible from the inputs.
//
// Ratio measures (RR / HR / OR) are pooled on the natural-log scale, which is the
// standard because the log effect is approximately normal and the CI is symmetric
// there. Inputs may be supplied either as a point estimate + confidence interval
// (the common case for a published/registered HR) or as raw 2x2 event counts.

import { riskRatioFromCounts } from "./biostats";
import { ciZ, chiSquareSurvival, studentTInverse } from "./stats/distributions";

export type RatioMeasure = "RR" | "HR" | "OR";

// One study as supplied by the caller. Provide EITHER (point + ciLower + ciUpper)
// OR raw counts (events/total per arm). Arm 1 is the treatment/exposed arm.
export interface StudyEffectInput {
  label: string;
  measure: RatioMeasure;
  point?: number | null;
  ciLower?: number | null;
  ciUpper?: number | null;
  ciPct?: number | null; // CI width of the supplied interval, default 95
  events1?: number | null;
  total1?: number | null;
  events2?: number | null;
  total2?: number | null;
}

// A study after standardization to the log scale, with its pooling weights.
export interface StudyEffect {
  label: string;
  measure: RatioMeasure;
  yi: number; // log effect
  vi: number; // variance of the log effect
  point: number; // ratio scale
  ciLower: number;
  ciUpper: number;
  weightFixedPct: number; // % of total fixed-effect weight
  weightRandomPct: number; // % of total random-effect weight
}

export interface PooledEstimate {
  model: "fixed" | "random";
  point: number; // back-transformed ratio
  ciLower: number;
  ciUpper: number;
  logPoint: number;
  se: number;
  reductionPercent: number; // (1 - point) * 100
  significant: boolean; // 95% CI excludes the null of 1
}

export interface Heterogeneity {
  q: number; // Cochran's Q
  df: number;
  pValue: number; // upper-tail chi-square p for Q
  iSquared: number; // % of variability due to heterogeneity (0..100)
  tauSquared: number; // between-study variance (DerSimonian–Laird)
  hSquared: number; // Q / df
}

export interface MetaAnalysisResult {
  measure: RatioMeasure;
  k: number; // number of pooled studies
  studies: StudyEffect[];
  fixed: PooledEstimate;
  random: PooledEstimate;
  heterogeneity: Heterogeneity;
  // 95% prediction interval for a new study's true effect (random-effects,
  // t_{k-2}); null when k < 3 (undefined below three studies).
  predictionInterval: { lower: number; upper: number } | null;
  skipped: { label: string; reason: string }[];
}

const DEFAULT_CI_PCT = 95;

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// Standardize one input study to a log effect yi and its variance vi. Returns a
// reason string instead when the study cannot be used (so the caller can surface
// exactly why a study was dropped rather than silently ignoring it).
function toLogEffect(
  input: StudyEffectInput
): { yi: number; vi: number; point: number; ciLower: number; ciUpper: number } | { reason: string } {
  const hasInterval =
    typeof input.point === "number" &&
    typeof input.ciLower === "number" &&
    typeof input.ciUpper === "number";

  if (hasInterval) {
    const point = input.point as number;
    const lo = input.ciLower as number;
    const hi = input.ciUpper as number;
    if (point <= 0 || lo <= 0 || hi <= 0) {
      return { reason: "Ratio point/CI must be positive to take logs." };
    }
    if (hi <= lo) {
      return { reason: "CI upper bound must exceed the lower bound." };
    }
    const z = ciZ(input.ciPct ?? DEFAULT_CI_PCT);
    const yi = Math.log(point);
    const se = (Math.log(hi) - Math.log(lo)) / (2 * z);
    return { yi, vi: se * se, point, ciLower: lo, ciUpper: hi };
  }

  // Fall back to raw counts. HR cannot be reconstructed from counts alone
  // (it needs time-to-event data), so counts are only valid for RR / OR.
  const { events1, total1, events2, total2, measure } = input;
  const counts = [events1, total1, events2, total2];
  if (!counts.every((c) => typeof c === "number")) {
    return { reason: "Provide either point+CI or all four 2x2 counts." };
  }
  if (measure === "HR") {
    return { reason: "HR cannot be derived from 2x2 counts; supply point+CI." };
  }
  if (measure === "OR") {
    return oddsRatioFromCounts(events1 as number, total1 as number, events2 as number, total2 as number);
  }
  const rr = riskRatioFromCounts(events1 as number, total1 as number, events2 as number, total2 as number);
  if (!rr) return { reason: "2x2 counts are unusable (zero arm total or out of range)." };
  const z = ciZ(DEFAULT_CI_PCT);
  const yi = Math.log(rr.riskRatio);
  const se = (Math.log(rr.ciUpper) - Math.log(rr.ciLower)) / (2 * z);
  return { yi, vi: se * se, point: rr.riskRatio, ciLower: rr.ciLower, ciUpper: rr.ciUpper };
}

// log-OR + variance from a 2x2 table: SE(ln OR) = sqrt(1/a+1/b+1/c+1/d) with a
// 0.5 Haldane–Anscombe correction when any cell is zero.
function oddsRatioFromCounts(
  events1: number,
  total1: number,
  events2: number,
  total2: number
): { yi: number; vi: number; point: number; ciLower: number; ciUpper: number } | { reason: string } {
  if (total1 <= 0 || total2 <= 0) return { reason: "Arm totals must be positive." };
  if (events1 < 0 || events2 < 0 || events1 > total1 || events2 > total2) {
    return { reason: "Event counts out of range." };
  }
  let a = events1;
  let b = total1 - events1;
  let c = events2;
  let d = total2 - events2;
  if (a === 0 || b === 0 || c === 0 || d === 0) {
    a += 0.5;
    b += 0.5;
    c += 0.5;
    d += 0.5;
  }
  const or = (a * d) / (b * c);
  const se = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
  const yi = Math.log(or);
  const z = ciZ(DEFAULT_CI_PCT);
  return {
    yi,
    vi: se * se,
    point: round(or, 3),
    ciLower: round(Math.exp(yi - z * se), 2),
    ciUpper: round(Math.exp(yi + z * se), 2),
  };
}

function pool(
  studies: { yi: number; vi: number }[],
  tauSquared: number
): { logPoint: number; se: number; weights: number[] } {
  const weights = studies.map((s) => 1 / (s.vi + tauSquared));
  const sumW = weights.reduce((acc, w) => acc + w, 0);
  const sumWy = studies.reduce((acc, s, i) => acc + weights[i] * s.yi, 0);
  const logPoint = sumWy / sumW;
  const se = Math.sqrt(1 / sumW);
  return { logPoint, se, weights };
}

function estimate(
  logPoint: number,
  se: number,
  model: "fixed" | "random"
): PooledEstimate {
  const z = ciZ(DEFAULT_CI_PCT);
  const point = Math.exp(logPoint);
  const ciLower = Math.exp(logPoint - z * se);
  const ciUpper = Math.exp(logPoint + z * se);
  return {
    model,
    point: round(point, 3),
    ciLower: round(ciLower, 3),
    ciUpper: round(ciUpper, 3),
    logPoint,
    se,
    reductionPercent: round((1 - point) * 100, 1),
    significant: ciUpper < 1 || ciLower > 1,
  };
}

/**
 * Pool a set of ratio-measure studies into a fixed-effect and random-effects
 * meta-analysis. All studies must share the same `measure` (you cannot pool HRs
 * with ORs); mismatched or unusable studies are dropped into `skipped` with a
 * reason rather than silently ignored. Returns null when fewer than two usable
 * studies remain (a "meta-analysis" of one study is just that study).
 *
 * Method: inverse-variance weighting on the log scale (fixed effect) and
 * DerSimonian–Laird between-study variance (random effects) — the exact closed
 * forms implemented by metafor/RevMan. Pure: does not mutate its inputs.
 */
export function metaAnalyze(inputs: readonly StudyEffectInput[]): MetaAnalysisResult | null {
  if (inputs.length === 0) return null;

  // The measure of the first usable study defines the pool; others must match.
  const measure = inputs[0].measure;
  const skipped: { label: string; reason: string }[] = [];
  const studies: StudyEffect[] = [];
  const raw: { yi: number; vi: number }[] = [];

  for (const input of inputs) {
    if (input.measure !== measure) {
      skipped.push({ label: input.label, reason: `Measure ${input.measure} differs from pool measure ${measure}.` });
      continue;
    }
    const std = toLogEffect(input);
    if ("reason" in std) {
      skipped.push({ label: input.label, reason: std.reason });
      continue;
    }
    if (std.vi <= 0 || !Number.isFinite(std.vi) || !Number.isFinite(std.yi)) {
      skipped.push({ label: input.label, reason: "Degenerate variance (zero-width CI)." });
      continue;
    }
    raw.push({ yi: std.yi, vi: std.vi });
    studies.push({
      label: input.label,
      measure,
      yi: std.yi,
      vi: std.vi,
      point: round(std.point, 3),
      ciLower: round(std.ciLower, 3),
      ciUpper: round(std.ciUpper, 3),
      weightFixedPct: 0,
      weightRandomPct: 0,
    });
  }

  const k = raw.length;
  if (k < 2) return null;

  // Fixed-effect pool (tau^2 = 0).
  const fe = pool(raw, 0);

  // Cochran's Q and DerSimonian–Laird tau^2.
  const q = raw.reduce((acc, s, i) => acc + fe.weights[i] * (s.yi - fe.logPoint) ** 2, 0);
  const df = k - 1;
  const sumW = fe.weights.reduce((a, w) => a + w, 0);
  const sumW2 = fe.weights.reduce((a, w) => a + w * w, 0);
  const c = sumW - sumW2 / sumW; // scaling constant for DL
  const tauSquared = c > 0 ? Math.max(0, (q - df) / c) : 0;
  const iSquared = q > df ? ((q - df) / q) * 100 : 0;
  const hSquared = q / df;

  // Random-effects pool.
  const re = pool(raw, tauSquared);

  // Fill per-study weight percentages now that both pools are known.
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
      lower: round(Math.exp(re.logPoint - t * sePred), 3),
      upper: round(Math.exp(re.logPoint + t * sePred), 3),
    };
  }

  return {
    measure,
    k,
    studies,
    fixed: estimate(fe.logPoint, fe.se, "fixed"),
    random: estimate(re.logPoint, re.se, "random"),
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
