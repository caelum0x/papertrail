import { describe, it, expect } from "vitest";
import {
  bucherIndirect,
  combineDirectIndirect,
  type Contrast,
} from "../lib/networkMeta";

// Oracle test for the Bucher indirect comparison. The indirect A-vs-C estimate is
// hand-computable: on the log scale the two contrast logs add and the variances
// add, then exp() back-transforms to the ratio scale.
//
//   A-vs-B: logHR = ln(0.80) = -0.223144,  Var = 0.02
//   B-vs-C: logHR = ln(0.75) = -0.287682,  Var = 0.03
//
//   indirect A-vs-C: logHR = -0.510825 → HR = exp(-0.510825) = 0.60
//                    Var   = 0.05, SE = 0.223607
//                    95% CI = exp(-0.510825 ± 1.959964 * 0.223607)
//                           = [0.3862, 0.9319]
const AB: Contrast = { logEffect: Math.log(0.8), variance: 0.02 };
const BC: Contrast = { logEffect: Math.log(0.75), variance: 0.03 };

describe("bucherIndirect — hand-computed indirect A-vs-C oracle", () => {
  const ac = bucherIndirect(AB, BC);

  it("adds the log effects and variances (A-vs-C = A-vs-B + B-vs-C)", () => {
    expect(ac.logEffect).toBeCloseTo(Math.log(0.8) + Math.log(0.75), 6);
    expect(ac.variance).toBeCloseTo(0.05, 6);
    expect(ac.se).toBeCloseTo(Math.sqrt(0.05), 5);
  });

  it("back-transforms to HR ≈ 0.60 with 95% CI ≈ [0.386, 0.932]", () => {
    expect(ac.point).toBeCloseTo(0.6, 3);
    expect(ac.ciLower).toBeCloseTo(0.3862, 2);
    expect(ac.ciUpper).toBeCloseTo(0.9319, 2);
    expect(ac.significant).toBe(true); // CI excludes 1
  });
});

describe("combineDirectIndirect — incoherence (inconsistency) test", () => {
  // Indirect A-vs-C from above: logHR ≈ -0.5108, Var = 0.05 (protective).
  const indirect: Contrast = {
    logEffect: Math.log(0.8) + Math.log(0.75),
    variance: 0.05,
  };

  it("flags inconsistency when a direct trial strongly disagrees", () => {
    // Direct A-vs-C trial finds HARM (HR ≈ 1.5), the opposite direction, tight CI.
    const direct: Contrast = { logEffect: Math.log(1.5), variance: 0.02 };
    const combined = combineDirectIndirect(direct, indirect);

    // z = (ln1.5 - (-0.5108)) / sqrt(0.02 + 0.05)
    //   = (0.405465 + 0.510825) / 0.264575 ≈ 3.463 → p ≈ 0.00053
    expect(combined.incoherence.incoherenceZ).toBeCloseTo(3.463, 1);
    expect(combined.incoherence.pValue).toBeLessThan(0.05);
    expect(combined.incoherence.inconsistent).toBe(true);
  });

  it("does not flag inconsistency when direct agrees with indirect", () => {
    // Direct A-vs-C trial agrees (HR ≈ 0.62, same protective direction).
    const direct: Contrast = { logEffect: Math.log(0.62), variance: 0.03 };
    const combined = combineDirectIndirect(direct, indirect);

    expect(Math.abs(combined.incoherence.incoherenceZ)).toBeLessThan(1.96);
    expect(combined.incoherence.pValue).toBeGreaterThan(0.05);
    expect(combined.incoherence.inconsistent).toBe(false);
    // Combined estimate sits between the two, inverse-variance weighted.
    expect(combined.point).toBeGreaterThan(0.55);
    expect(combined.point).toBeLessThan(0.65);
  });
});
