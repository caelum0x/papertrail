import { describe, it, expect } from "vitest";
import {
  metaRegression,
  predict,
  MetaRegressionRequestSchema,
  type MetaRegressionPoint,
} from "../lib/metaRegression";

// Oracle test: locks the inverse-variance weighted least squares fit to the closed
// form implemented by metafor's `rma(..., mods = ~x)`. To keep the arithmetic
// hand-checkable we use equal variances (vi = 1 → equal weights, so WLS reduces to
// ordinary least squares) and disable the residual tau^2 so the reported fit is the
// pure fixed-effect WLS.
//
// LINEAR fixture: x = (1, 2, 3, 4), y = (2.1, 3.9, 6.1, 7.9), all vi = 1.
//   meanX = 2.5, meanY = 5.0
//   Sxx = 2.25 + 0.25 + 0.25 + 2.25 = 5
//   Sxy = 4.35 + 0.55 + 0.55 + 4.35 = 9.8
//   slope = 9.8 / 5 = 1.96
//   intercept = 5.0 - 1.96 * 2.5 = 0.1
//   With weights all = 1 the model-based SEs are:
//     SE(slope)     = sqrt(1 / Sxx)               = sqrt(1/5)  = 0.4472136
//     SE(intercept) = sqrt(1/n + meanX^2 / Sxx)   = sqrt(1.5)  = 1.2247449
//   residuals (0.04, -0.12, 0.12, -0.04) → residual Q = 0.032, df = 2
const LINEAR: MetaRegressionPoint[] = [
  { label: "A", yi: 2.1, vi: 1, x: 1 },
  { label: "B", yi: 3.9, vi: 1, x: 2 },
  { label: "C", yi: 6.1, vi: 1, x: 3 },
  { label: "D", yi: 7.9, vi: 1, x: 4 },
];

describe("metaRegression — linear oracle (equal-weight OLS)", () => {
  const r = metaRegression(LINEAR, { residualHeterogeneity: false })!;

  it("regresses all four studies with residual df = k - 2", () => {
    expect(r).not.toBeNull();
    expect(r.k).toBe(4);
    expect(r.residualDf).toBe(2);
    expect(r.tauSquared).toBe(0);
  });

  it("slope ≈ 1.96 and intercept ≈ 0.1", () => {
    expect(r.slope).toBeCloseTo(1.96, 6);
    expect(r.intercept).toBeCloseTo(0.1, 6);
  });

  it("model-based SEs match the closed form", () => {
    expect(r.slopeSe).toBeCloseTo(0.4472136, 6);
    expect(r.interceptSe).toBeCloseTo(1.2247449, 6);
  });

  it("residual Q ≈ 0.032 (weighted RSS)", () => {
    expect(r.residualQ).toBeCloseTo(0.032, 6);
  });

  it("slope is significant (moderator explains variation)", () => {
    // z = 1.96 / sqrt(1/5) = 1.96 * sqrt(5) = 4.3826932; two-sided t_2 p < 0.05.
    expect(r.slopeZ).toBeCloseTo(4.3826932, 5);
    expect(r.slopePValue).toBeLessThan(0.05);
  });

  it("predict() returns the fitted log effect", () => {
    expect(r.predict(2)).toBeCloseTo(0.1 + 1.96 * 2, 6);
    expect(predict(r, 3)).toBeCloseTo(0.1 + 1.96 * 3, 6);
  });
});

// NULL-SLOPE fixture: y is flat (all 5.0) regardless of x → slope exactly 0, so the
// moderator explains nothing. Intercept = 5.0, residual Q = 0.
const FLAT: MetaRegressionPoint[] = [
  { label: "A", yi: 5.0, vi: 1, x: 10 },
  { label: "B", yi: 5.0, vi: 1, x: 20 },
  { label: "C", yi: 5.0, vi: 1, x: 30 },
  { label: "D", yi: 5.0, vi: 1, x: 40 },
];

describe("metaRegression — null-slope fixture", () => {
  const r = metaRegression(FLAT, { residualHeterogeneity: false })!;

  it("slope is 0 and NOT significant", () => {
    expect(r.slope).toBeCloseTo(0, 10);
    expect(r.slopePValue).toBeGreaterThanOrEqual(0.05);
  });

  it("intercept equals the flat effect and residual Q is 0", () => {
    expect(r.intercept).toBeCloseTo(5.0, 8);
    expect(r.residualQ).toBeCloseTo(0, 8);
    expect(r.rSquaredAnalog).toBe(0); // no total heterogeneity to explain
  });
});

describe("metaRegression — guards", () => {
  it("returns null for k < 3", () => {
    expect(
      metaRegression([
        { label: "A", yi: 0.1, vi: 1, x: 1 },
        { label: "B", yi: 0.2, vi: 1, x: 2 },
      ])
    ).toBeNull();
  });

  it("returns null when all moderator values are identical (< 2 distinct x)", () => {
    expect(
      metaRegression([
        { label: "A", yi: 0.1, vi: 1, x: 5 },
        { label: "B", yi: 0.2, vi: 1, x: 5 },
        { label: "C", yi: 0.3, vi: 1, x: 5 },
      ])
    ).toBeNull();
  });

  it("drops unusable points (vi <= 0, non-finite) before counting k", () => {
    // Two usable + one bad → only 2 usable → null.
    expect(
      metaRegression([
        { label: "A", yi: 0.1, vi: 1, x: 1 },
        { label: "B", yi: 0.2, vi: 0, x: 2 },
        { label: "C", yi: 0.3, vi: 1, x: 3 },
      ])
    ).toBeNull();
  });
});

describe("MetaRegressionRequestSchema — boundary validation", () => {
  it("rejects fewer than 3 points", () => {
    const out = MetaRegressionRequestSchema.safeParse({
      points: [{ label: "A", yi: 0.1, vi: 1, x: 1 }],
    });
    expect(out.success).toBe(false);
  });

  it("rejects a non-positive variance", () => {
    const out = MetaRegressionRequestSchema.safeParse({
      points: [
        { label: "A", yi: 0.1, vi: 1, x: 1 },
        { label: "B", yi: 0.2, vi: -1, x: 2 },
        { label: "C", yi: 0.3, vi: 1, x: 3 },
      ],
    });
    expect(out.success).toBe(false);
  });

  it("accepts a well-formed request", () => {
    const out = MetaRegressionRequestSchema.safeParse({
      moderator: "dose_mg",
      points: LINEAR.map((p) => ({ label: p.label, yi: p.yi, vi: p.vi, x: p.x })),
    });
    expect(out.success).toBe(true);
  });
});
