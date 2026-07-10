import { describe, it, expect } from "vitest";
import {
  requiredInformationSize,
  obrienFlemingBoundary,
  trialSequentialVerdict,
} from "../lib/trialSequential";
import { normalQuantile } from "../lib/stats/distributions";

// Oracle test: locks the trial-sequential engine to hand-computable closed forms.
// Every reference value is derived independently of the implementation.

describe("requiredInformationSize — hand-checkable RIS oracle", () => {
  it("controlRisk 0.10, RRR 0.25, alpha 0.05, power 0.80", () => {
    // p2 = 0.10, p1 = 0.10 * (1 - 0.25) = 0.075, delta = -0.025.
    // z_{0.025} = 1.959964, z_{0.80} = 0.841621, (za+zb)^2 = 7.848878.
    // variancePart = 0.075*0.925 + 0.10*0.90 = 0.069375 + 0.09 = 0.159375.
    // base = 7.848878 * 0.159375 / 0.025^2 = 2001.4643; perGroup = 2*base ≈ 4002.93.
    const r = requiredInformationSize({
      controlRisk: 0.1,
      relativeRiskReduction: 0.25,
      alpha: 0.05,
      power: 0.8,
    });
    expect(r.p2).toBeCloseTo(0.1, 10);
    expect(r.p1).toBeCloseTo(0.075, 10);
    expect(r.risPerGroup).toBe(4003); // ceil(4002.93)
    expect(r.risTotal).toBe(8006);
    expect(r.diversityAdjusted).toBe(false);
  });

  it("inflates by 1/(1 - I²) when heterogeneity is supplied", () => {
    const base = requiredInformationSize({
      controlRisk: 0.1,
      relativeRiskReduction: 0.25,
    });
    const adjusted = requiredInformationSize({
      controlRisk: 0.1,
      relativeRiskReduction: 0.25,
      iSquared: 0.5, // factor 1/(1-0.5) = 2x
    });
    expect(adjusted.diversityAdjusted).toBe(true);
    // ~2x the per-group RIS (ceil rounding aside).
    expect(adjusted.risPerGroup).toBeGreaterThan(base.risPerGroup * 1.99);
    expect(adjusted.risPerGroup).toBeLessThan(base.risPerGroup * 2.01 + 2);
  });
});

describe("obrienFlemingBoundary — Lan–DeMets OBF oracle", () => {
  it("Z(0.5) = z_{0.0125} / sqrt(0.5)", () => {
    const expected = normalQuantile(1 - 0.05 / 4) / Math.sqrt(0.5);
    const b = obrienFlemingBoundary({ informationFraction: 0.5, alpha: 0.05 });
    expect(b.z).toBeCloseTo(expected, 10);
    // z_{0.0125} ≈ 2.2414, / sqrt(0.5) ≈ 3.1698.
    expect(b.z).toBeCloseTo(3.1698, 3);
    expect(b.informationFraction).toBe(0.5);
  });
});

describe("trialSequentialVerdict — discrete verdicts", () => {
  it("conclusive_benefit when cumulative Z crosses the OBF boundary", () => {
    // At t = 0.5 the boundary is ≈ 3.17; a cumulative Z of 4.0 crosses it.
    const v = trialSequentialVerdict({
      accruedN: 4000,
      ris: 8000,
      cumulativeZ: 4.0,
      alpha: 0.05,
    });
    expect(v.verdict).toBe("conclusive_benefit");
    expect(v.crossedBenefit).toBe(true);
    expect(v.informationFraction).toBeCloseTo(0.5, 10);
  });

  it("insufficient_information when neither boundary nor RIS is reached", () => {
    // Same 50% information but a modest Z of 1.5 does not clear the ≈3.17 boundary.
    const v = trialSequentialVerdict({
      accruedN: 4000,
      ris: 8000,
      cumulativeZ: 1.5,
      alpha: 0.05,
    });
    expect(v.verdict).toBe("insufficient_information");
    expect(v.crossedBenefit).toBe(false);
    expect(v.crossedNoEffect).toBe(false);
  });

  it("conclusive_no_effect once the full RIS accrues without crossing", () => {
    const v = trialSequentialVerdict({
      accruedN: 8000,
      ris: 8000,
      cumulativeZ: 0.5,
      alpha: 0.05,
    });
    expect(v.verdict).toBe("conclusive_no_effect");
    expect(v.crossedNoEffect).toBe(true);
  });
});
