// Deterministic Kaplan–Meier / log-rank / Cox proportional-hazards engine. This
// DEEPENS PaperTrail's survival moat by porting the approach of `lifelines` (MIT)
// down to the estimators a translational-research audience actually trusts:
//   - the Kaplan–Meier product-limit survival curve with Greenwood's variance and a
//     log-log (complementary log-log) 95% CI — the same CI `lifelines`'
//     KaplanMeierFitter reports by default,
//   - the two-group log-rank test (observed-minus-expected with the hypergeometric
//     variance) giving a chi-square (df=1), p-value, and the Peto O–E hazard ratio,
//   - a Cox partial-likelihood model for a single 0/1 covariate fit by Newton–Raphson
//     with Breslow handling of tied event times.
//
// Everything here is a pure, immutable, closed-form computation of an accepted
// biostatistics formula. There is NO LLM anywhere in the numeric loop, no network, no
// randomness, and no mutation of inputs. It reuses lib/stats/distributions.ts for the
// normal-quantile machinery (`ciZ`) and `chiSquareSurvival` for the log-rank p-value —
// it never reimplements the quantile, the CDF, or a ties correction.
//
// Degenerate inputs (no events, empty groups, a non-invertible Cox information) return
// null / converged:false rather than throwing — the caller can defer honestly.

import { ciZ, chiSquareSurvival } from "./stats/distributions";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

const Z95 = ciZ(95); // ≈ 1.959964

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

// A pre-aggregated risk-table row: at `time`, `atRisk` subjects were still at risk,
// `deaths` events occurred, and (optionally) `censored` subjects were censored right
// after. This is the classic life-table form.
export interface RiskTableRow {
  time: number;
  atRisk: number;
  deaths: number;
  censored?: number;
}

// A raw per-subject duration: followed until `time`, with `event01` = 1 if the event
// occurred at `time` and 0 if the subject was right-censored at `time`.
export interface Duration {
  time: number;
  event01: 0 | 1;
}

// A per-subject observation for the log-rank / Cox models: a duration, an event flag,
// and (for Cox) a single binary covariate `x` (0 = reference, 1 = exposed).
export interface CoxSubject {
  time: number;
  event01: 0 | 1;
  x: 0 | 1;
}

// ---------------------------------------------------------------------------
// 1. Kaplan–Meier product-limit estimator
// ---------------------------------------------------------------------------

export interface KMPoint {
  time: number;
  survival: number; // S(t) = product over t_i<=t of (1 - d_i/n_i)
  atRisk: number; // n_i just before t_i
  deaths: number; // d_i at t_i
  variance: number; // Greenwood's variance of S(t)
  ciLower: number; // log-log (cloglog) 95% CI lower
  ciUpper: number; // log-log (cloglog) 95% CI upper
}

export interface KaplanMeierResult {
  curve: KMPoint[];
  medianSurvival: number | null; // first time with S(t) <= 0.5, or null if never reached
  totalDeaths: number;
  totalAtRisk: number; // subjects at risk at the very first event time
}

// Type guard: are these raw durations rather than a pre-aggregated risk table?
function isDurationArray(rows: RiskTableRow[] | Duration[]): rows is Duration[] {
  return rows.length > 0 && "event01" in rows[0];
}

// Collapse raw per-subject durations into an ordered risk table. At each distinct time
// we count deaths (event01=1) and censorings (event01=0); the number at risk at a time
// is everyone whose duration is >= that time.
function toRiskTable(durations: Duration[]): RiskTableRow[] {
  const times = Array.from(new Set(durations.map((d) => d.time))).sort((a, b) => a - b);
  return times.map((t) => {
    const deaths = durations.filter((d) => d.time === t && d.event01 === 1).length;
    const censored = durations.filter((d) => d.time === t && d.event01 === 0).length;
    const atRisk = durations.filter((d) => d.time >= t).length;
    return { time: t, atRisk, deaths, censored };
  });
}

/**
 * Kaplan–Meier product-limit survival curve.
 *
 * Accepts either an ordered array of life-table rows [{time, atRisk, deaths, censored?}]
 * or an array of raw durations [{time, event01}] (collapsed internally into a risk
 * table). Returns the survival curve with, at each event time:
 *   - S(t)  = Π (1 - d_i / n_i),
 *   - Greenwood's variance  Var[S(t)] = S(t)² · Σ d_i / (n_i (n_i - d_i)),
 *   - a log-log (complementary log-log) 95% CI, which — unlike the naive
 *     S ± z·SE(S) interval — stays inside [0, 1] and matches lifelines' default.
 * Plus `medianSurvival`, the first time S(t) <= 0.5 (null if the curve never drops
 * that far). Only rows with at least one death advance the step function, matching the
 * product-limit convention. Returns null on empty/degenerate input rather than throwing.
 *
 * Pure: never mutates its inputs; returns fresh objects.
 */
export function kaplanMeier(
  rows: RiskTableRow[] | Duration[]
): KaplanMeierResult | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const table: RiskTableRow[] = isDurationArray(rows)
    ? toRiskTable(rows)
    : [...rows].sort((a, b) => a.time - b.time);

  // Validate the table: finite, non-negative, deaths<=atRisk, atRisk>0 where deaths>0.
  for (const r of table) {
    if (![r.time, r.atRisk, r.deaths].every((v) => Number.isFinite(v))) return null;
    if (r.atRisk < 0 || r.deaths < 0) return null;
    if (r.deaths > r.atRisk) return null;
  }

  const totalDeaths = table.reduce((s, r) => s + r.deaths, 0);
  if (totalDeaths === 0) return null; // no events → no informative KM curve

  let survival = 1;
  // Greenwood running sum: Σ d_i / (n_i (n_i - d_i)).
  let greenwoodSum = 0;
  const curve: KMPoint[] = [];

  for (const r of table) {
    // Only event times advance the product-limit step function.
    if (r.deaths <= 0 || r.atRisk <= 0) continue;

    const factor = 1 - r.deaths / r.atRisk;
    survival *= factor;

    const denom = r.atRisk * (r.atRisk - r.deaths);
    if (denom > 0) greenwoodSum += r.deaths / denom;

    const variance = survival * survival * greenwoodSum;

    // Log-log (cloglog) CI: transform g = ln(-ln S), SE(g) = SE(S)/(S·|ln S|),
    // then invert. Stays within [0,1]. Degenerates to {S,S} once S hits 0 or 1.
    let ciLower = survival;
    let ciUpper = survival;
    if (survival > 0 && survival < 1) {
      const logS = Math.log(survival);
      const seG = Math.sqrt(greenwoodSum) / Math.abs(logS); // SE of ln(-ln S)
      const g = Math.log(-logS);
      // Larger g ⇒ smaller S, so the upper-g bound maps to the lower survival bound.
      ciLower = Math.exp(-Math.exp(g + Z95 * seG));
      ciUpper = Math.exp(-Math.exp(g - Z95 * seG));
    }

    curve.push({
      time: r.time,
      survival: round(survival, 6),
      atRisk: r.atRisk,
      deaths: r.deaths,
      variance: round(variance, 8),
      ciLower: round(Math.max(0, Math.min(1, ciLower)), 6),
      ciUpper: round(Math.max(0, Math.min(1, ciUpper)), 6),
    });
  }

  if (curve.length === 0) return null;

  const medianPoint = curve.find((p) => p.survival <= 0.5);
  const medianSurvival = medianPoint ? medianPoint.time : null;

  return {
    curve,
    medianSurvival,
    totalDeaths,
    totalAtRisk: curve[0].atRisk,
  };
}

// ---------------------------------------------------------------------------
// 2. Two-group log-rank test
// ---------------------------------------------------------------------------

export interface LogRankResult {
  chiSquare: number; // (O_A - E_A)² / V  (Mantel–Haenszel form, df = 1)
  df: 1;
  pValue: number; // upper-tail chi-square p-value
  observedA: number; // observed events in group A
  expectedA: number; // expected events in group A under the null
  varianceA: number; // summed hypergeometric variance
  hazardRatio: number; // Peto O–E hazard ratio, exp((O_A - E_A) / V)
  eventTimes: number; // number of distinct event times pooled
}

/**
 * Two-group log-rank test. At each distinct event time t across the pooled sample,
 * with n = subjects at risk, d = total deaths, and (nA, dA) the group-A slice:
 *   expected_A += d · nA / n
 *   variance  += d · (nA/n) · (nB/n) · (n - d) / (n - 1)    [hypergeometric]
 * The statistic is (O_A - E_A)² / V ~ χ²(1); the Peto hazard ratio is
 * exp((O_A - E_A) / V). Accepts raw durations per group. Returns null if either group
 * is empty or there are no events (V = 0) rather than throwing.
 *
 * Pure: never mutates its inputs.
 */
export function logRankTest(
  groupA: Duration[],
  groupB: Duration[]
): LogRankResult | null {
  if (!Array.isArray(groupA) || !Array.isArray(groupB)) return null;
  if (groupA.length === 0 || groupB.length === 0) return null;
  for (const d of [...groupA, ...groupB]) {
    if (!Number.isFinite(d.time)) return null;
    if (d.event01 !== 0 && d.event01 !== 1) return null;
  }

  const allTimes = Array.from(
    new Set([...groupA, ...groupB].filter((d) => d.event01 === 1).map((d) => d.time))
  ).sort((a, b) => a - b);

  if (allTimes.length === 0) return null; // no events at all

  let observedA = 0;
  let expectedA = 0;
  let variance = 0;

  for (const t of allTimes) {
    const nA = groupA.filter((d) => d.time >= t).length;
    const nB = groupB.filter((d) => d.time >= t).length;
    const n = nA + nB;
    if (n <= 1) continue; // hypergeometric variance undefined for n<=1

    const dA = groupA.filter((d) => d.time === t && d.event01 === 1).length;
    const dB = groupB.filter((d) => d.time === t && d.event01 === 1).length;
    const d = dA + dB;
    if (d === 0) continue;

    observedA += dA;
    expectedA += (d * nA) / n;
    variance += (d * (nA / n) * (nB / n) * (n - d)) / (n - 1);
  }

  if (variance <= 0) return null;

  const oMinusE = observedA - expectedA;
  const chiSquare = (oMinusE * oMinusE) / variance;
  const pValue = chiSquareSurvival(chiSquare, 1);
  const hazardRatio = Math.exp(oMinusE / variance);

  return {
    chiSquare: round(chiSquare, 4),
    df: 1,
    pValue: round(pValue, 6),
    observedA,
    expectedA: round(expectedA, 4),
    varianceA: round(variance, 4),
    hazardRatio: round(hazardRatio, 4),
    eventTimes: allTimes.length,
  };
}

// ---------------------------------------------------------------------------
// 3. Cox proportional-hazards model (single binary covariate, Breslow ties)
// ---------------------------------------------------------------------------

export interface CoxResult {
  beta: number; // log hazard ratio for x=1 vs x=0
  hazardRatio: number; // exp(beta)
  se: number; // standard error of beta (1 / sqrt(information))
  ciLower: number; // 95% CI on the HR scale
  ciUpper: number;
  z: number; // Wald z = beta / se
  pValue: number; // two-sided Wald p-value
  logLikelihood: number; // partial log-likelihood at the fitted beta
  iterations: number;
  converged: boolean;
}

const COX_MAX_ITER = 50;
const COX_TOL = 1e-9;

/**
 * Cox proportional-hazards model for a SINGLE binary (0/1) covariate, fit by
 * Newton–Raphson on the Breslow partial log-likelihood (the ties handling `lifelines`
 * and R's `coxph(ties="breslow")` use).
 *
 * With covariate x_i ∈ {0,1} and hazard ∝ exp(β·x), at each distinct event time the
 * risk set R contributes, letting θ = e^β and (n1, s1) the count and covariate-sum of
 * the risk set (s1 = number of x=1 at risk):
 *   score U(β)      = Σ_events [ x_event − d · (s1·θ) / (n0 + s1·θ) ]
 *   information I(β)= Σ_events   d · (s1·θ·n0) / (n0 + s1·θ)²
 * where n0 = (# x=0 at risk), and d = number of ties at that time (Breslow shares one
 * risk set across the d tied events). We iterate β ← β + U/I until |U/I| < tol.
 *
 * Returns { beta, hazardRatio, se, ciLower, ciUpper, z, pValue, logLikelihood,
 * iterations, converged }. On a degenerate design (no events, no variation in x within
 * risk sets, or a non-positive information matrix) it returns converged:false rather
 * than throwing.
 *
 * Pure: never mutates its inputs. Reuses lib/stats/distributions ciZ for the CI.
 */
export function coxPHbinary(subjects: CoxSubject[]): CoxResult | null {
  if (!Array.isArray(subjects) || subjects.length === 0) return null;
  for (const s of subjects) {
    if (!Number.isFinite(s.time)) return null;
    if (s.event01 !== 0 && s.event01 !== 1) return null;
    if (s.x !== 0 && s.x !== 1) return null;
  }

  const eventTimes = Array.from(
    new Set(subjects.filter((s) => s.event01 === 1).map((s) => s.time))
  ).sort((a, b) => a - b);

  if (eventTimes.length === 0) return null; // no events

  // Guard: if x never varies, or events only ever occur in one x stratum with no
  // opposing risk, β is not identifiable — bail as non-converged.
  const anyX1 = subjects.some((s) => s.x === 1);
  const anyX0 = subjects.some((s) => s.x === 0);
  if (!anyX1 || !anyX0) {
    return {
      beta: 0,
      hazardRatio: 1,
      se: NaN,
      ciLower: NaN,
      ciUpper: NaN,
      z: NaN,
      pValue: NaN,
      logLikelihood: NaN,
      iterations: 0,
      converged: false,
    };
  }

  // Precompute per-event-time aggregates that don't depend on β.
  const strata = eventTimes.map((t) => {
    const atRisk = subjects.filter((s) => s.time >= t);
    const n1 = atRisk.filter((s) => s.x === 1).length; // covariate-sum of risk set
    const n0 = atRisk.filter((s) => s.x === 0).length;
    const tied = subjects.filter((s) => s.time === t && s.event01 === 1);
    const d = tied.length; // number of tied events
    const eventXSum = tied.reduce((acc, s) => acc + s.x, 0); // Σ x over the d events
    return { n1, n0, d, eventXSum };
  });

  let beta = 0;
  let iterations = 0;
  let converged = false;

  for (let iter = 0; iter < COX_MAX_ITER; iter++) {
    iterations = iter + 1;
    const theta = Math.exp(beta);
    let score = 0;
    let information = 0;

    for (const { n1, n0, d, eventXSum } of strata) {
      const denom = n0 + n1 * theta;
      if (denom <= 0) continue;
      const p = (n1 * theta) / denom; // expected covariate value in the risk set
      score += eventXSum - d * p;
      information += d * p * (1 - p);
    }

    if (!(information > 0) || !Number.isFinite(information)) {
      // Non-positive / non-finite information — cannot take a Newton step.
      return {
        beta,
        hazardRatio: Math.exp(beta),
        se: NaN,
        ciLower: NaN,
        ciUpper: NaN,
        z: NaN,
        pValue: NaN,
        logLikelihood: NaN,
        iterations,
        converged: false,
      };
    }

    const step = score / information;
    beta += step;

    if (Math.abs(step) < COX_TOL) {
      converged = true;
      break;
    }
  }

  // Final information at the fitted beta for the SE, plus the partial log-likelihood.
  const theta = Math.exp(beta);
  let information = 0;
  let logLik = 0;
  for (const { n1, n0, d, eventXSum } of strata) {
    const denom = n0 + n1 * theta;
    if (denom <= 0) continue;
    const p = (n1 * theta) / denom;
    information += d * p * (1 - p);
    // Breslow partial log-likelihood contribution: β·Σx_events − d·ln(denominator).
    logLik += beta * eventXSum - d * Math.log(denom);
  }

  if (!(information > 0) || !Number.isFinite(information)) {
    return {
      beta: round(beta, 6),
      hazardRatio: round(Math.exp(beta), 6),
      se: NaN,
      ciLower: NaN,
      ciUpper: NaN,
      z: NaN,
      pValue: NaN,
      logLikelihood: Number.isFinite(logLik) ? round(logLik, 6) : NaN,
      iterations,
      converged: false,
    };
  }

  const se = 1 / Math.sqrt(information);
  const z = beta / se;
  const hazardRatio = Math.exp(beta);
  const ciLower = Math.exp(beta - Z95 * se);
  const ciUpper = Math.exp(beta + Z95 * se);
  // Two-sided Wald p-value from the standard normal: 2·(1 − Φ(|z|)) via the
  // chi-square(1) survival, since z² ~ χ²(1).
  const pValue = chiSquareSurvival(z * z, 1);

  return {
    beta: round(beta, 6),
    hazardRatio: round(hazardRatio, 6),
    se: round(se, 6),
    ciLower: round(ciLower, 6),
    ciUpper: round(ciUpper, 6),
    z: round(z, 4),
    pValue: round(pValue, 6),
    logLikelihood: round(logLik, 6),
    iterations,
    converged,
  };
}
