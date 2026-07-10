import { describe, it, expect } from "vitest";
import { kaplanMeier, logRankTest, coxPHbinary } from "../lib/survivalCurves";
import type { Duration, CoxSubject } from "../lib/survivalCurves";

// Minimal oracle: lock the Kaplan–Meier / log-rank / Cox engine to hand-computable
// reference numbers (the estimators lifelines / R survival report). Small, exact sets
// so every asserted value can be derived by hand and cross-checked.

describe("kaplanMeier — product-limit oracle", () => {
  // Durations: 1(event), 2(event), 3(censored), 4(event), 5(event). n starts at 5.
  //  t=1: S = 1·(1-1/5)             = 0.8
  //  t=2: S = 0.8·(1-1/4)           = 0.6
  //  (t=3 is censored → no step)
  //  t=4: S = 0.6·(1-1/2)           = 0.3
  //  t=5: S = 0.3·(1-1/1)           = 0.0
  // Greenwood variance at t=1: S²·Σ d/(n(n-d)) = 0.8²·(1/(5·4)) = 0.032.
  // median = first time S ≤ 0.5 = 4.
  const durations: Duration[] = [
    { time: 1, event01: 1 },
    { time: 2, event01: 1 },
    { time: 3, event01: 0 },
    { time: 4, event01: 1 },
    { time: 5, event01: 1 },
  ];

  it("locks S(t), Greenwood variance, log-log CI and median", () => {
    const r = kaplanMeier(durations)!;
    expect(r).not.toBeNull();
    expect(r.curve.map((p) => p.survival)).toEqual([0.8, 0.6, 0.3, 0]);
    expect(r.curve.map((p) => p.time)).toEqual([1, 2, 4, 5]);
    expect(r.medianSurvival).toBe(4);
    expect(r.totalDeaths).toBe(4);
    expect(r.totalAtRisk).toBe(5);

    // Greenwood variance at t=1 = 0.032.
    expect(r.curve[0].variance).toBeCloseTo(0.032, 6);
    // Log-log (cloglog) 95% CI at t=1: 0.2038 .. 0.9692.
    expect(r.curve[0].ciLower).toBeCloseTo(0.203809, 5);
    expect(r.curve[0].ciUpper).toBeCloseTo(0.96918, 5);
  });

  it("returns null when there are no events", () => {
    expect(kaplanMeier([{ time: 5, event01: 0 }])).toBeNull();
    expect(kaplanMeier([])).toBeNull();
  });
});

describe("logRankTest — O–E oracle", () => {
  // Interleaved event times; hand-computed pooled O_A, E_A, V.
  const A: Duration[] = [
    { time: 1, event01: 1 },
    { time: 3, event01: 1 },
    { time: 5, event01: 1 },
    { time: 7, event01: 0 },
  ];
  const B: Duration[] = [
    { time: 2, event01: 1 },
    { time: 4, event01: 1 },
    { time: 6, event01: 1 },
    { time: 8, event01: 0 },
  ];

  it("locks O_A, E_A, variance, chi-square and Peto HR", () => {
    const r = logRankTest(A, B)!;
    expect(r).not.toBeNull();
    expect(r.observedA).toBe(3);
    expect(r.expectedA).toBeCloseTo(2.6619, 3);
    expect(r.varianceA).toBeCloseTo(1.4571, 3);
    expect(r.chiSquare).toBeCloseTo(0.0784, 3);
    expect(r.hazardRatio).toBeCloseTo(1.2612, 3);
    expect(r.df).toBe(1);
    expect(r.pValue).toBeGreaterThan(0.05); // not significant
  });

  it("returns null on an empty group", () => {
    expect(logRankTest([], B)).toBeNull();
  });
});

describe("coxPHbinary — partial-likelihood oracle (Breslow)", () => {
  // A symmetric design where the exposed arm (x=1) has systematically earlier events,
  // producing exactly HR = 2 (β = ln 2) under the Breslow partial likelihood.
  const subjects: CoxSubject[] = [
    { time: 2, event01: 1, x: 1 },
    { time: 3, event01: 1, x: 1 },
    { time: 4, event01: 1, x: 1 },
    { time: 9, event01: 0, x: 1 },
    { time: 5, event01: 1, x: 0 },
    { time: 6, event01: 1, x: 0 },
    { time: 8, event01: 1, x: 0 },
    { time: 10, event01: 0, x: 0 },
  ];

  it("recovers beta = ln 2, HR = 2 and a finite SE", () => {
    const r = coxPHbinary(subjects)!;
    expect(r).not.toBeNull();
    expect(r.converged).toBe(true);
    expect(r.beta).toBeCloseTo(Math.log(2), 5); // 0.693147
    expect(r.hazardRatio).toBeCloseTo(2, 5);
    expect(r.se).toBeCloseTo(0.837871, 5);
    // CI = exp(ln2 ± 1.95996·0.837871).
    expect(r.ciLower).toBeCloseTo(Math.exp(Math.log(2) - 1.959964 * 0.837871), 4);
    expect(r.ciUpper).toBeCloseTo(Math.exp(Math.log(2) + 1.959964 * 0.837871), 4);
  });

  it("returns converged:false when the covariate never varies", () => {
    const r = coxPHbinary([
      { time: 1, event01: 1, x: 1 },
      { time: 2, event01: 1, x: 1 },
    ])!;
    expect(r.converged).toBe(false);
  });
});
