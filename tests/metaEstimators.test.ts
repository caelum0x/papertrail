import { describe, it, expect } from "vitest";
import {
  tauSquaredHedges,
  tauSquaredSidikJonkman,
  tauSquaredPauleMandel,
  generalizedQ,
  type WeightedPoint,
} from "../lib/metaEstimators";

// Oracle test: locks each ported PyMARE tau^2 estimator to hand-computed
// reference values on a FIXED yi/vi fixture. The reference numbers below were
// derived directly from the closed-form / estimating-equation definitions in
// PyMARE's estimators.py + stats.py (see the formulas documented in
// lib/metaEstimators.ts), not by re-running the code under test.
//
// FIXED FIXTURE (five studies on the analysis/log scale):
//   yi = [0.10, 0.30, 0.35, 0.65, 0.45]
//   vi = [0.03, 0.02, 0.05, 0.04, 0.06]
//   k  = 5,  df = k - 1 = 4
//
// Derived constants (all exact arithmetic):
//   ȳ (unweighted)  = (0.10+0.30+0.35+0.65+0.45)/5 = 1.85/5 = 0.37
//   mean(vi)        = (0.03+0.02+0.05+0.04+0.06)/5 = 0.20/5 = 0.04
//   Σ(yi-ȳ)^2       = 0.0729 + 0.0049 + 0.0004 + 0.0784 + 0.0064 = 0.1630
//
//   Hedges:
//     MSE   = 0.1630 / (k-1) = 0.1630 / 4 = 0.04075
//     tau^2 = MSE - mean(vi) = 0.04075 - 0.04 = 0.00075
//
//   Sidik–Jonkman:
//     tau0^2 = Σ(yi-ȳ)^2 / k = 0.1630 / 5 = 0.0326
//     r_i^{-1} = tau0^2 / (v_i + tau0^2), rescaled weighted SS / (k-1)
//     => tau^2 ≈ 0.0194996  (computed from the exact two-step SJ formula)
//
//   Paule–Mandel: root of generalized Q(tau^2) = df = 4.
//     Q(0) = 4.6058429...  > 4, so a unique positive root exists.
//     => tau^2 ≈ 0.00532645, at which generalizedQ === 4 (the estimating eqn).
const FIXTURE: WeightedPoint[] = [
  { yi: 0.1, vi: 0.03 },
  { yi: 0.3, vi: 0.02 },
  { yi: 0.35, vi: 0.05 },
  { yi: 0.65, vi: 0.04 },
  { yi: 0.45, vi: 0.06 },
];

const DF = FIXTURE.length - 1;

describe("tauSquaredHedges — method-of-moments oracle", () => {
  it("equals MSE − mean(vi) = 0.04075 − 0.04 = 0.00075", () => {
    expect(tauSquaredHedges(FIXTURE)).toBeCloseTo(0.00075, 8);
  });

  it("truncates to exactly 0 when effects are homogeneous (no over-dispersion)", () => {
    // All yi equal → MSE = 0 → tau^2 = -mean(vi) < 0 → clamped to 0.
    const homogeneous: WeightedPoint[] = [
      { yi: 0.2, vi: 0.03 },
      { yi: 0.2, vi: 0.04 },
      { yi: 0.2, vi: 0.05 },
    ];
    expect(tauSquaredHedges(homogeneous)).toBe(0);
  });
});

describe("tauSquaredSidikJonkman — two-step positive estimator oracle", () => {
  it("equals the exact two-step SJ formula ≈ 0.0194996", () => {
    expect(tauSquaredSidikJonkman(FIXTURE)).toBeCloseTo(0.0194996, 6);
  });

  it("returns a strictly positive estimate for over-dispersed data", () => {
    expect(tauSquaredSidikJonkman(FIXTURE)).toBeGreaterThan(0);
  });

  it("returns 0 when all effects are identical (tau0^2 = 0)", () => {
    const identical: WeightedPoint[] = [
      { yi: 0.5, vi: 0.02 },
      { yi: 0.5, vi: 0.03 },
    ];
    expect(tauSquaredSidikJonkman(identical)).toBe(0);
  });
});

describe("tauSquaredPauleMandel — iterative estimating-equation oracle", () => {
  const result = tauSquaredPauleMandel(FIXTURE);

  it("converges to tau^2 ≈ 0.00532645", () => {
    expect(result.converged).toBe(true);
    expect(result.tau2).toBeCloseTo(0.00532645, 6);
  });

  it("the returned tau^2 solves the estimating equation Q(tau^2) = df", () => {
    // The defining property of PM: generalized Q at the estimate equals k − 1.
    expect(result.residualQ).toBeCloseTo(DF, 6);
    expect(generalizedQ(FIXTURE, result.tau2)).toBeCloseTo(DF, 6);
  });

  it("brackets the root: Q is above df below it and below df above it", () => {
    // Monotone decreasing Q ⇒ the estimate is a genuine sign-change root.
    expect(generalizedQ(FIXTURE, result.tau2 - 1e-3)).toBeGreaterThan(DF);
    expect(generalizedQ(FIXTURE, result.tau2 + 1e-3)).toBeLessThan(DF);
  });

  it("returns exactly 0 when Q(0) ≤ df (no over-dispersion, no positive root)", () => {
    // Two studies whose effects agree within sampling error: Q(0) < df.
    const underDispersed: WeightedPoint[] = [
      { yi: 0.2, vi: 0.5 },
      { yi: 0.25, vi: 0.5 },
    ];
    const r = tauSquaredPauleMandel(underDispersed);
    expect(r.tau2).toBe(0);
    expect(r.converged).toBe(true);
    expect(r.iterations).toBe(0);
    expect(generalizedQ(underDispersed, 0)).toBeLessThanOrEqual(underDispersed.length - 1);
  });
});

describe("generalizedQ — Cochran's Q building block", () => {
  it("at tau^2 = 0 equals ordinary Cochran's Q (> df here) ≈ 4.60584", () => {
    expect(generalizedQ(FIXTURE, 0)).toBeCloseTo(4.60584, 4);
  });

  it("is strictly decreasing in tau^2", () => {
    const q0 = generalizedQ(FIXTURE, 0);
    const q1 = generalizedQ(FIXTURE, 0.01);
    const q2 = generalizedQ(FIXTURE, 0.1);
    expect(q1).toBeLessThan(q0);
    expect(q2).toBeLessThan(q1);
  });

  it("rejects negative tau^2 explicitly", () => {
    expect(() => generalizedQ(FIXTURE, -0.01)).toThrow(/>= 0/);
  });
});

describe("input validation — all estimators fail fast on bad input", () => {
  it("throws when fewer than two studies are supplied", () => {
    const one: WeightedPoint[] = [{ yi: 0.1, vi: 0.02 }];
    expect(() => tauSquaredHedges(one)).toThrow(/at least two/);
    expect(() => tauSquaredSidikJonkman(one)).toThrow(/at least two/);
    expect(() => tauSquaredPauleMandel(one)).toThrow(/at least two/);
  });

  it("throws on non-positive or non-finite variance", () => {
    const badVar: WeightedPoint[] = [
      { yi: 0.1, vi: 0 },
      { yi: 0.2, vi: 0.02 },
    ];
    expect(() => tauSquaredHedges(badVar)).toThrow(/positive/);
    const nanEffect: WeightedPoint[] = [
      { yi: Number.NaN, vi: 0.02 },
      { yi: 0.2, vi: 0.02 },
    ];
    expect(() => tauSquaredSidikJonkman(nanEffect)).toThrow(/finite/);
  });
});
