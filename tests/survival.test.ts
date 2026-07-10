import { describe, it, expect } from "vitest";
import {
  hazardRatioFromLogrank,
  medianSurvivalRatio,
  absoluteRiskAtTimepoint,
  verifyAgainstSurvival,
  SurvivalRequestSchema,
} from "../lib/survival";

// Oracle tests: lock the deterministic survival engine to accepted reference formulas.
// The Peto (logrank O–E) hazard ratio is exp((O1 - E1) / V) with CI exp((O1-E1)/V ±
// z/sqrt(V)) — the same estimator metafor's escalc(measure="PETO") and RevMan use.
// Median ratio, ARR@t and NNT are elementary closed forms. This converts "we wrote the
// survival biostatistics ourselves" into "our numbers equal the standard tools'."

describe("hazardRatioFromLogrank — Peto O–E oracle", () => {
  it("O=13, E=22, V=9.5 → HR exp(-9/9.5)=0.388, 95% CI 0.21–0.73 (metafor PETO)", () => {
    const r = hazardRatioFromLogrank(13, 22, 9.5)!;
    expect(r).not.toBeNull();
    // ln(HR) = (13 - 22) / 9.5 = -0.947368; HR = exp(-0.947368) = 0.38776
    expect(r.logHazardRatio).toBeCloseTo(-0.9474, 4);
    expect(r.hazardRatio).toBeCloseTo(0.388, 3);
    // SE(ln HR) = 1/sqrt(9.5) = 0.324443
    expect(r.seLogHazardRatio).toBeCloseTo(0.3244, 4);
    // CI = exp(-0.947368 ± 1.959964 * 0.324443) = 0.2053 .. 0.7324
    expect(r.ciLower).toBeCloseTo(0.21, 2);
    expect(r.ciUpper).toBeCloseTo(0.73, 2);
    // (1 - 0.38776) * 100 = 61.2%
    expect(r.reductionPercent).toBeCloseTo(61.2, 1);
    expect(r.significant).toBe(true);
  });

  it("O=E (no difference) → HR 1.00 exactly, CI straddles the null (not significant)", () => {
    const r = hazardRatioFromLogrank(30, 30, 10)!;
    expect(r.hazardRatio).toBeCloseTo(1, 3);
    expect(r.logHazardRatio).toBeCloseTo(0, 4);
    // CI = exp(0 ± 1.959964 / sqrt(10)) = 0.538 .. 1.859
    expect(r.ciLower).toBeCloseTo(0.54, 2);
    expect(r.ciUpper).toBeCloseTo(1.86, 2);
    expect(r.significant).toBe(false);
  });

  it("more observed than expected events → HR > 1 (harm)", () => {
    const r = hazardRatioFromLogrank(40, 30, 12)!;
    // ln(HR) = 10/12 = 0.8333; HR = exp(0.8333) = 2.301
    expect(r.hazardRatio).toBeGreaterThan(1);
    expect(r.reductionPercent).toBeLessThan(0);
  });

  it("returns null for unusable inputs (variance must be > 0)", () => {
    expect(hazardRatioFromLogrank(13, 22, 0)).toBeNull();
    expect(hazardRatioFromLogrank(13, 22, -1)).toBeNull();
    expect(hazardRatioFromLogrank(NaN, 22, 9.5)).toBeNull();
  });
});

describe("medianSurvivalRatio — ratio + guard", () => {
  it("18 vs 12 months → ratio 1.5 (50% longer median survival)", () => {
    const r = medianSurvivalRatio(18, 12)!;
    expect(r.ratio).toBeCloseTo(1.5, 3);
    expect(r.prolongationPercent).toBeCloseTo(50, 1);
  });

  it("equal medians → ratio 1.0, no prolongation", () => {
    const r = medianSurvivalRatio(12, 12)!;
    expect(r.ratio).toBeCloseTo(1, 3);
    expect(r.prolongationPercent).toBeCloseTo(0, 1);
  });

  it("guards zero / negative medians (returns null)", () => {
    expect(medianSurvivalRatio(0, 12)).toBeNull();
    expect(medianSurvivalRatio(18, 0)).toBeNull();
    expect(medianSurvivalRatio(-5, 12)).toBeNull();
  });
});

describe("absoluteRiskAtTimepoint — KM ARR@t / NNT oracle", () => {
  it("S_control(t)=0.70, S_treat(t)=0.85 → ARR 0.15, NNT 6.7", () => {
    const r = absoluteRiskAtTimepoint(0.7, 0.85, 24)!;
    expect(r.timepoint).toBe(24);
    expect(r.riskControl).toBeCloseTo(0.3, 4);
    expect(r.riskTreatment).toBeCloseTo(0.15, 4);
    // ARR = S_treat - S_control = 0.85 - 0.70 = 0.15
    expect(r.absoluteRiskReduction).toBeCloseTo(0.15, 4);
    // NNT = 1 / 0.15 = 6.667
    expect(r.numberNeededToTreat).toBeCloseTo(6.7, 1);
  });

  it("no benefit (treatment survival <= control) → ARR <= 0, NNT null", () => {
    const r = absoluteRiskAtTimepoint(0.8, 0.75, 12)!;
    expect(r.absoluteRiskReduction).toBeLessThanOrEqual(0);
    expect(r.numberNeededToTreat).toBeNull();
  });

  it("rejects survival probabilities outside [0,1]", () => {
    expect(absoluteRiskAtTimepoint(1.2, 0.8)).toBeNull();
    expect(absoluteRiskAtTimepoint(0.8, -0.1)).toBeNull();
  });
});

describe("verifyAgainstSurvival — deterministic claim reconciler", () => {
  it("matches_hr: '30% reduction' vs HR 0.70", () => {
    const r = verifyAgainstSurvival("Drug X reduced the risk of death by 30%", {
      hazardRatio: 0.7,
    });
    expect(r.verdict).toBe("matches_hr");
    expect(r.claimedReductionPercent).toBeCloseTo(30, 1);
    expect(r.hrReductionPercent).toBeCloseTo(30, 1);
  });

  it("overstates_hr: 'cut mortality in half' (50%) vs HR 0.90 (10%)", () => {
    const r = verifyAgainstSurvival("Drug X cut mortality in half", {
      hazardRatio: 0.9,
    });
    expect(r.verdict).toBe("overstates_hr");
    expect(r.claimedReductionPercent).toBeCloseTo(50, 1);
  });

  it("understates_hr: modest '10% reduction' claim vs strong HR 0.50 (50%)", () => {
    const r = verifyAgainstSurvival("Treatment lowered events by 10%", {
      hazardRatio: 0.5,
    });
    expect(r.verdict).toBe("understates_hr");
  });

  it("not_significant: benefit claim vs HR 0.85 whose CI crosses 1", () => {
    const r = verifyAgainstSurvival("Drug X reduced deaths by 15%", {
      hazardRatio: 0.85,
      hrCiLower: 0.68,
      hrCiUpper: 1.06,
    });
    expect(r.verdict).toBe("not_significant");
  });

  it("median_vs_hr_mismatch: HR 0.95 but medians 24 vs 12 (implied HR ~0.5)", () => {
    const r = verifyAgainstSurvival("Drug X improved survival", {
      hazardRatio: 0.95,
      medianTreatment: 24,
      medianControl: 12,
    });
    expect(r.verdict).toBe("median_vs_hr_mismatch");
    expect(r.medianRatio).toBeCloseTo(2, 3);
    expect(r.medianImpliedHr).toBeCloseTo(0.5, 3);
  });

  it("cannot_reconcile: no HR and no median pair", () => {
    const r = verifyAgainstSurvival("Drug X reduced events by 30%", {});
    expect(r.verdict).toBe("cannot_reconcile");
    expect(r.hazardRatio).toBeNull();
  });

  it("cannot_reconcile: HR present but claim states no comparable magnitude", () => {
    const r = verifyAgainstSurvival("Drug X was well tolerated in the trial", {
      hazardRatio: 0.7,
    });
    expect(r.verdict).toBe("cannot_reconcile");
    expect(r.claimedReductionPercent).toBeNull();
  });

  it("does not mutate its input data object", () => {
    const data = { hazardRatio: 0.7 };
    const snapshot = { ...data };
    verifyAgainstSurvival("reduced by 30%", data);
    expect(data).toEqual(snapshot);
  });
});

describe("SurvivalRequestSchema — boundary validation", () => {
  it("accepts a valid request with an HR", () => {
    const parsed = SurvivalRequestSchema.parse({
      claim: "Drug X reduced the risk of death by 30%",
      hazardRatio: 0.7,
      hrCiLower: 0.6,
      hrCiUpper: 0.82,
    });
    expect(parsed.claim).toContain("Drug X");
    expect(parsed.hazardRatio).toBe(0.7);
  });

  it("rejects a too-short claim", () => {
    const res = SurvivalRequestSchema.safeParse({ claim: "short" });
    expect(res.success).toBe(false);
  });

  it("rejects a survival probability outside [0,1]", () => {
    const res = SurvivalRequestSchema.safeParse({
      claim: "Drug X reduced the risk of death by 30%",
      survivalControl: 1.5,
    });
    expect(res.success).toBe(false);
  });

  it("rejects a non-positive hazard ratio", () => {
    const res = SurvivalRequestSchema.safeParse({
      claim: "Drug X reduced the risk of death by 30%",
      hazardRatio: 0,
    });
    expect(res.success).toBe(false);
  });
});
