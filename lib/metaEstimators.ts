// Additional between-study variance (tau^2) estimators for random-effects
// meta-analysis, ported natively from PyMARE (github.com/neurostuff/PyMARE,
// MIT license) — specifically the method-of-moments and iterative estimators in
// `pymare/estimators/estimators.py` and the generalized Cochran Q in
// `pymare/stats.py`.
//
// Our existing engine (lib/metaAnalysis.ts) already uses DerSimonian–Laird for
// tau^2. This module adds the three complementary estimators from the PyMARE /
// metafor family so callers can report tau^2 under alternative moment/iterative
// methods — Hedges (unweighted method-of-moments), Sidik–Jonkman (a positive
// estimator that never truncates to exactly zero from its interior form), and
// Paule–Mandel (the iterative estimator that solves the generalized-Q
// estimating equation).
//
// Everything here is pure, deterministic numeric code operating on the
// log-effect scale (yi) and its sampling variances (vi) — no LLM, no mutation,
// no randomness. All three estimators are specialized to the intercept-only
// (single overall mean) model, which is the meta-analysis case; the design
// matrix X in PyMARE reduces to a column of ones, so the weighted-least-squares
// step collapses to the inverse-variance weighted mean.
//
// The estimating equations here are elementary algebra (inverse-variance
// weighted means and sums of squares), so no heavy distribution helper is
// needed; lib/stats/distributions remains the home for the CDF/quantile forms
// used elsewhere in the meta-analysis stack.

// Smallest tau^2 bracket half-width the Paule–Mandel bisection will resolve
// before declaring convergence on the tau^2 axis (as opposed to convergence on
// the Q residual). Well below any meaningful between-study variance.
const EPSILON_TAU2 = 1e-12;

// A study reduced to its effect estimate on the analysis scale and the variance
// of that estimate. For ratio measures this is the log effect and the variance
// of the log effect (matching lib/metaAnalysis.ts `yi`/`vi`).
export interface WeightedPoint {
  yi: number;
  vi: number;
}

// The default convergence controls for the iterative Paule–Mandel solver.
// PyMARE delegates PM-style root finding to SciPy; here we use monotone
// bisection on the generalized-Q estimating equation, which is guaranteed to
// converge because Q(tau^2) is continuous and strictly decreasing in tau^2.
export const PM_MAX_ITER = 200;
export const PM_TOLERANCE = 1e-10;
// Upper bracket for the PM root. tau^2 is a variance on the (log-)effect scale;
// 1e6 dwarfs any realistic between-study variance while keeping bisection cheap.
const PM_UPPER_BRACKET = 1e6;

function sum(xs: readonly number[]): number {
  return xs.reduce((acc, x) => acc + x, 0);
}

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? NaN : sum(xs) / xs.length;
}

// Validate the shared input contract for every estimator: at least two studies
// (tau^2 is undefined for k < 2), and strictly positive, finite variances so the
// inverse-variance weights are well defined. Throws explicitly rather than
// returning a silent NaN, so callers surface the reason.
function assertUsable(points: readonly WeightedPoint[]): void {
  if (points.length < 2) {
    throw new Error("tau^2 estimation requires at least two studies.");
  }
  for (const { yi, vi } of points) {
    if (!Number.isFinite(yi)) {
      throw new Error("Effect estimate (yi) must be finite.");
    }
    if (!Number.isFinite(vi) || vi <= 0) {
      throw new Error("Sampling variance (vi) must be a finite positive number.");
    }
  }
}

// Inverse-variance weighted mean of the effects under a given between-study
// variance tau^2. With weights w_i = 1/(v_i + tau^2), this is the fixed-effect
// pooled estimate when tau^2 = 0 and the random-effects pooled estimate
// otherwise — the intercept-only reduction of PyMARE's weighted_least_squares.
function weightedMean(points: readonly WeightedPoint[], tau2: number): number {
  const w = points.map((p) => 1 / (p.vi + tau2));
  const sw = sum(w);
  return sum(points.map((p, i) => w[i] * p.yi)) / sw;
}

/**
 * Generalized Cochran's Q at a given tau^2 (PyMARE `q_gen`, intercept-only case):
 *
 *   Q(tau^2) = Σ w_i (y_i − ȳ_w)^2 ,   w_i = 1 / (v_i + tau^2),
 *   ȳ_w      = Σ w_i y_i / Σ w_i .
 *
 * Q is continuous and strictly decreasing in tau^2. At tau^2 = 0 it is the
 * ordinary Cochran's Q; the Paule–Mandel estimator is the value of tau^2 that
 * drives Q down to its expectation under the random-effects model, k − 1.
 * Exposed for oracle tests that assert the PM root solves Q(tau^2) = k − 1.
 */
export function generalizedQ(points: readonly WeightedPoint[], tau2: number): number {
  if (tau2 < 0) {
    throw new Error("tau^2 must be >= 0.");
  }
  const ybar = weightedMean(points, tau2);
  const w = points.map((p) => 1 / (p.vi + tau2));
  return sum(points.map((p, i) => w[i] * (p.yi - ybar) ** 2));
}

/**
 * Hedges (HE) method-of-moments estimator of tau^2 (PyMARE `Hedges`).
 *
 * Fits the overall mean by ordinary (unit-weight) least squares — for the
 * intercept-only model this is the *unweighted* mean ȳ — then equates the OLS
 * residual mean square to its expectation:
 *
 *   MSE   = Σ (y_i − ȳ)^2 / (k − 1)
 *   tau^2 = MSE − (1/k) Σ v_i ,   truncated at 0.
 *
 * Unlike DerSimonian–Laird, HE weights every study equally when forming the
 * moment, so it is unbiased under the random-effects model but less efficient.
 */
export function tauSquaredHedges(points: readonly WeightedPoint[]): number {
  assertUsable(points);
  const k = points.length;
  const yi = points.map((p) => p.yi);
  const vi = points.map((p) => p.vi);
  const ybarOls = mean(yi);
  const mse = sum(yi.map((y) => (y - ybarOls) ** 2)) / (k - 1);
  const tau2 = mse - mean(vi);
  return Math.max(0, tau2);
}

/**
 * Sidik–Jonkman (SJ) estimator of tau^2 (PyMARE variance-based family,
 * `sidik2005simple`).
 *
 * A two-step method-of-moments estimator. It first forms a crude, strictly
 * positive initial between-study variance from the unweighted spread,
 *
 *   tau0^2 = (1/k) Σ (y_i − ȳ)^2 ,
 *
 * then rescales each sampling variance by that initial value,
 *
 *   r_i   = (v_i + tau0^2) / tau0^2 ,        (relative variance)
 *   ȳ_r   = Σ r_i^{-1} y_i / Σ r_i^{-1} ,
 *   tau^2 = (1 / (k − 1)) Σ r_i^{-1} (y_i − ȳ_r)^2 .
 *
 * Because r_i^{-1} > 0 the interior estimate is always positive; we still guard
 * with a max(0, …) for the degenerate all-equal-effects case where tau0^2 = 0.
 */
export function tauSquaredSidikJonkman(points: readonly WeightedPoint[]): number {
  assertUsable(points);
  const k = points.length;
  const yi = points.map((p) => p.yi);
  const vi = points.map((p) => p.vi);

  const ybarU = mean(yi);
  const tau0 = sum(yi.map((y) => (y - ybarU) ** 2)) / k;

  // All effects identical: no between-study variability to detect.
  if (tau0 <= 0) return 0;

  const rInv = vi.map((v) => tau0 / (v + tau0)); // r_i^{-1}
  const swr = sum(rInv);
  const ybarR = sum(rInv.map((w, i) => w * yi[i])) / swr;
  const tau2 = sum(rInv.map((w, i) => w * (yi[i] - ybarR) ** 2)) / (k - 1);
  return Math.max(0, tau2);
}

export interface PauleMandelResult {
  tau2: number;
  iterations: number;
  converged: boolean;
  // Generalized Q evaluated at the returned tau^2. When tau^2 > 0 this should
  // equal k − 1 (the estimating-equation target) to within tolerance.
  residualQ: number;
}

/**
 * Paule–Mandel (PM) iterative estimator of tau^2 (PyMARE iterative estimator;
 * `paule1982consensus`, equivalent to the empirical-Bayes / Q-generalized root).
 *
 * PM defines tau^2 as the solution of the estimating equation
 *
 *   Q(tau^2) = k − 1 ,
 *
 * where Q is the generalized Cochran's Q above. Q(tau^2) is continuous and
 * strictly monotonically decreasing in tau^2, so the root is unique when it
 * exists. Two boundary cases:
 *
 *   • If Q(0) ≤ k − 1 the data show no more dispersion than sampling error
 *     alone predicts, and the estimate is tau^2 = 0 (the equation has no
 *     positive root).
 *   • Otherwise a unique positive root exists and is found by bisection on
 *     [0, PM_UPPER_BRACKET], exploiting monotonicity (no derivative needed).
 *
 * Returns the estimate along with the iteration count, a convergence flag, and
 * the residual Q so callers/tests can assert the estimating equation is solved.
 */
export function tauSquaredPauleMandel(
  points: readonly WeightedPoint[],
  options: { maxIter?: number; tolerance?: number } = {}
): PauleMandelResult {
  assertUsable(points);
  const maxIter = options.maxIter ?? PM_MAX_ITER;
  const tolerance = options.tolerance ?? PM_TOLERANCE;
  const df = points.length - 1;

  // No positive root: dispersion is within sampling noise. tau^2 = 0 exactly.
  const q0 = generalizedQ(points, 0);
  if (q0 <= df) {
    return { tau2: 0, iterations: 0, converged: true, residualQ: q0 };
  }

  // Bisection on the monotone decreasing Q(tau^2) − df. Q(0) − df > 0 and
  // Q(PM_UPPER_BRACKET) − df < 0, so a sign change brackets the unique root.
  let lo = 0;
  let hi = PM_UPPER_BRACKET;
  let iterations = 0;
  let converged = false;
  let mid = 0;

  for (let i = 0; i < maxIter; i++) {
    iterations = i + 1;
    mid = (lo + hi) / 2;
    const q = generalizedQ(points, mid);
    if (Math.abs(q - df) < tolerance || (hi - lo) / 2 < EPSILON_TAU2) {
      converged = true;
      break;
    }
    // Q decreasing: if Q still above target, tau^2 must be larger.
    if (q > df) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return {
    tau2: mid,
    iterations,
    converged,
    residualQ: generalizedQ(points, mid),
  };
}
