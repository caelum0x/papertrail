import { describe, it, expect } from "vitest";
import {
  doseResponseTrend,
  DoseResponseRequestSchema,
  type DosePoint,
} from "../lib/doseResponse";

// Oracle test: locks the inverse-variance weighted least squares dose-response
// trend to the closed form implemented by metafor's `rma(..., mods = ~dose)`. To
// keep the arithmetic hand-checkable we use equal variances (vi = 1 → equal
// weights, so WLS reduces to ordinary least squares).
//
// MONOTONE fixture: dose = (10, 20, 30, 40), yi = (1, 2, 3, 4), all vi = 0.1.
//   Equal variances → equal weights w = 1/vi = 10, so WLS reduces to OLS for the
//   point estimates. Variances are 0.1 (not 1) so the slope is precise enough to be
//   significant at df = k - 2 = 2, where the critical |t|_{0.025} ≈ 4.303.
//   doseBar = 25
//   Sxx   = 15^2 + 5^2 + 5^2 + 15^2 = 500 (unweighted); Sxx_w = 10 * 500 = 5000
//   Sxy   = (-15)(-1.5) + (-5)(-0.5) + (5)(0.5) + (15)(1.5) = 50 (unweighted; yBar=2.5)
//   slope       = 50 / 500 = 0.1  (per unit dose; centering + weights cancel here)
//   SE(slope)   = sqrt(1 / Sxx_w) = sqrt(1 / 5000) = 0.01414214
//   slopeZ      = 0.1 / 0.01414214 = 7.071068  (> 4.303 → significant at df = 2)
//   intercept   = 2.5 - 0.1 * 25   = 0  → fitted = 0.1*dose = observed exactly
//   residual Q  = 0 (perfect linear fit)
const MONOTONE: DosePoint[] = [
  { label: "10 mg", dose: 10, yi: 1, vi: 0.1 },
  { label: "20 mg", dose: 20, yi: 2, vi: 0.1 },
  { label: "30 mg", dose: 30, yi: 3, vi: 0.1 },
  { label: "40 mg", dose: 40, yi: 4, vi: 0.1 },
];

describe("doseResponseTrend — monotone oracle (equal-weight OLS)", () => {
  const r = doseResponseTrend(MONOTONE)!;

  it("uses all four points with residual df = k - 2", () => {
    expect(r).not.toBeNull();
    expect(r.k).toBe(4);
    expect(r.distinctDoses).toBe(4);
    expect(r.residualDf).toBe(2);
  });

  it("slope ≈ 0.1 per unit dose with SE ≈ 0.0141421", () => {
    expect(r.slopePerUnitDose).toBeCloseTo(0.1, 8);
    expect(r.slopeSe).toBeCloseTo(0.01414214, 7);
    expect(r.slopeZ).toBeCloseTo(7.071068, 5);
    expect(r.intercept).toBeCloseTo(0, 8);
  });

  it("residual Q ≈ 0 (perfect linear fit)", () => {
    expect(r.residualQ).toBeCloseTo(0, 8);
  });

  it("reports an increasing trend (significant positive slope)", () => {
    expect(r.slopePValue).toBeLessThan(0.05);
    expect(r.trend).toBe("increasing");
  });

  it("fitted line passes through the observed effects", () => {
    expect(r.perDoseEffect.map((p) => p.dose)).toEqual([10, 20, 30, 40]);
    r.perDoseEffect.forEach((p, i) => {
      expect(p.fitted).toBeCloseTo(MONOTONE[i].yi, 8);
      expect(p.ciLower).toBeLessThan(p.fitted);
      expect(p.ciUpper).toBeGreaterThan(p.fitted);
    });
  });
});

// FLAT fixture: effect is constant regardless of dose → slope exactly 0, no trend.
const FLAT: DosePoint[] = [
  { label: "10 mg", dose: 10, yi: 5, vi: 1 },
  { label: "20 mg", dose: 20, yi: 5, vi: 1 },
  { label: "30 mg", dose: 30, yi: 5, vi: 1 },
  { label: "40 mg", dose: 40, yi: 5, vi: 1 },
];

describe("doseResponseTrend — flat fixture (no_trend)", () => {
  const r = doseResponseTrend(FLAT)!;

  it("slope is 0 and NOT significant → no_trend", () => {
    expect(r.slopePerUnitDose).toBeCloseTo(0, 10);
    expect(r.slopePValue).toBeGreaterThanOrEqual(0.05);
    expect(r.trend).toBe("no_trend");
  });

  it("intercept equals the flat effect and residual Q is 0", () => {
    expect(r.intercept).toBeCloseTo(5, 8);
    expect(r.residualQ).toBeCloseTo(0, 8);
  });
});

describe("doseResponseTrend — guards", () => {
  it("returns null for k < 3", () => {
    expect(
      doseResponseTrend([
        { label: "A", dose: 10, yi: 1, vi: 1 },
        { label: "B", dose: 20, yi: 2, vi: 1 },
      ])
    ).toBeNull();
  });

  it("returns null when all doses are identical (< 2 distinct doses)", () => {
    expect(
      doseResponseTrend([
        { label: "A", dose: 10, yi: 1, vi: 1 },
        { label: "B", dose: 10, yi: 2, vi: 1 },
        { label: "C", dose: 10, yi: 3, vi: 1 },
      ])
    ).toBeNull();
  });

  it("drops unusable points (vi <= 0) before counting k", () => {
    // Two usable + one bad → only 2 usable → null.
    expect(
      doseResponseTrend([
        { label: "A", dose: 10, yi: 1, vi: 1 },
        { label: "B", dose: 20, yi: 2, vi: 0 },
        { label: "C", dose: 30, yi: 3, vi: 1 },
      ])
    ).toBeNull();
  });
});

describe("DoseResponseRequestSchema — boundary validation", () => {
  it("rejects fewer than 3 points", () => {
    const out = DoseResponseRequestSchema.safeParse({
      points: [{ label: "A", dose: 10, yi: 1, vi: 1 }],
    });
    expect(out.success).toBe(false);
  });

  it("rejects a non-positive variance", () => {
    const out = DoseResponseRequestSchema.safeParse({
      points: [
        { label: "A", dose: 10, yi: 1, vi: 1 },
        { label: "B", dose: 20, yi: 2, vi: -1 },
        { label: "C", dose: 30, yi: 3, vi: 1 },
      ],
    });
    expect(out.success).toBe(false);
  });

  it("accepts a well-formed request", () => {
    const out = DoseResponseRequestSchema.safeParse({
      doseUnit: "mg/day",
      points: MONOTONE.map((p) => ({ label: p.label, dose: p.dose, yi: p.yi, vi: p.vi })),
    });
    expect(out.success).toBe(true);
  });
});
