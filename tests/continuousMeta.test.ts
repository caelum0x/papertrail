import { describe, it, expect } from "vitest";
import {
  meanDifference,
  hedgesG,
  poolContinuous,
  type ContinuousStudyInput,
} from "../lib/continuousMeta";

// Oracle test: locks the continuous-outcome engine to the closed-form
// inverse-variance / DerSimonian–Laird values metafor & RevMan implement. Every
// reference value below was hand-computed from the exact formulas (see the arm
// summaries inline) and is independent of the implementation under test.

describe("meanDifference — Welch-style MD oracle", () => {
  it("MD = meanT − meanC with unpooled SE = sqrt(sdT²/nT + sdC²/nC)", () => {
    const e = meanDifference({ label: "A", meanT: 5, sdT: 2, nT: 50, meanC: 3, sdC: 2, nC: 50 });
    // MD = 2; variance = 4/50 + 4/50 = 0.16; SE = 0.4
    expect(e.md).toBeCloseTo(2, 6);
    expect(e.variance).toBeCloseTo(0.16, 6);
    expect(e.se).toBeCloseTo(0.4, 6);
    // 95% CI = 2 ± 1.95996·0.4 = [1.2160, 2.7840]
    expect(e.ciLower).toBeCloseTo(1.216, 3);
    expect(e.ciUpper).toBeCloseTo(2.784, 3);
  });
});

describe("hedgesG — SMD with small-sample J correction oracle", () => {
  it("g = J·d with J = 1 − 3/(4·df−1) and the Var(g) closed form", () => {
    // meanT=10 sdT=2 nT=20 | meanC=7 sdC=2.5 nC=20; df = 38.
    // pooledSD = sqrt((19·4 + 19·6.25)/38) = sqrt(5.125) = 2.26385...
    // d = 3 / 2.26385 = 1.325178; J = 1 − 3/151 = 0.980132; g = 1.298850.
    // Var(g) = J²·( 40/400 + d²/76 ) = 0.118263; SE = 0.343895.
    const e = hedgesG({ label: "g", meanT: 10, sdT: 2, nT: 20, meanC: 7, sdC: 2.5, nC: 20 });
    expect(e.g).toBeCloseTo(1.2989, 3);
    expect(e.variance).toBeCloseTo(0.11826, 4);
    expect(e.se).toBeCloseTo(0.34389, 4);
    // The J correction shrinks g toward 0 relative to the raw d (1.3252).
    expect(e.g).toBeLessThan(1.3252);
  });
});

// Three-study MD fixture (arm means chosen so MD = 2, 1, 3.5 with variances
// 0.16, 0.3125, 0.60). Fixed ≈ 1.9370 (95% CI 1.349–2.525); Q ≈ 6.906, df = 2,
// τ² ≈ 0.7628, I² ≈ 71.0%; random ≈ 2.0621 (95% CI 0.880–3.245).
const THREE_MD: ContinuousStudyInput[] = [
  { label: "A", meanT: 5, sdT: 2, nT: 50, meanC: 3, sdC: 2, nC: 50 },
  { label: "B", meanT: 4, sdT: 2.5, nT: 40, meanC: 3, sdC: 2.5, nC: 40 },
  { label: "C", meanT: 6, sdT: 3, nT: 30, meanC: 2.5, sdC: 3, nC: 30 },
];

describe("poolContinuous — DerSimonian–Laird MD oracle (3-study fixture)", () => {
  const r = poolContinuous(THREE_MD, { measure: "MD" })!;

  it("pools all three studies on the MD scale with none skipped", () => {
    expect(r).not.toBeNull();
    expect(r.measure).toBe("MD");
    expect(r.k).toBe(3);
    expect(r.skipped).toHaveLength(0);
  });

  it("fixed-effect pooled MD ≈ 1.937 (95% CI 1.349–2.525), null of 0", () => {
    expect(r.fixed.point).toBeCloseTo(1.937, 2);
    expect(r.fixed.ciLower).toBeCloseTo(1.349, 2);
    expect(r.fixed.ciUpper).toBeCloseTo(2.525, 2);
    // CI is entirely above 0 → significant difference.
    expect(r.fixed.significant).toBe(true);
  });

  it("heterogeneity Q≈6.906, df=2, τ²≈0.763, I²≈71%", () => {
    expect(r.heterogeneity.q).toBeCloseTo(6.906, 1);
    expect(r.heterogeneity.df).toBe(2);
    expect(r.heterogeneity.tauSquared).toBeCloseTo(0.763, 1);
    expect(r.heterogeneity.iSquared).toBeCloseTo(71, 0);
  });

  it("random-effects pooled MD ≈ 2.062 (95% CI 0.880–3.245), wider than fixed", () => {
    expect(r.random.point).toBeCloseTo(2.062, 2);
    expect(r.random.ciLower).toBeCloseTo(0.88, 1);
    expect(r.random.ciUpper).toBeCloseTo(3.245, 1);
    // Random-effects CI is wider than fixed-effect (accounts for τ²).
    const feWidth = r.fixed.ciUpper - r.fixed.ciLower;
    const reWidth = r.random.ciUpper - r.random.ciLower;
    expect(reWidth).toBeGreaterThan(feWidth);
  });

  it("per-study fixed weights sum to ~100%, study A (smallest variance) heaviest", () => {
    const total = r.studies.reduce((a, s) => a + s.weightFixedPct, 0);
    expect(total).toBeCloseTo(100, 0);
    expect(r.studies[0].weightFixedPct).toBeGreaterThan(r.studies[2].weightFixedPct);
  });

  it("provides a 95% prediction interval bracketing the pooled estimate", () => {
    expect(r.predictionInterval).not.toBeNull();
    expect(r.predictionInterval!.lower).toBeLessThan(r.random.point);
    expect(r.predictionInterval!.upper).toBeGreaterThan(r.random.point);
  });
});

describe("poolContinuous — guard rails", () => {
  it("returns null for fewer than two usable studies", () => {
    expect(poolContinuous([], { measure: "MD" })).toBeNull();
    expect(
      poolContinuous([{ label: "A", meanT: 5, sdT: 2, nT: 50, meanC: 3, sdC: 2, nC: 50 }], {
        measure: "MD",
      })
    ).toBeNull();
  });

  it("pools on the SMD (Hedges g) scale when measure = SMD", () => {
    const r = poolContinuous(THREE_MD, { measure: "SMD" })!;
    expect(r.measure).toBe("SMD");
    expect(r.k).toBe(3);
    // g effects are in SD units; all positive here → pooled effect positive.
    expect(r.fixed.point).toBeGreaterThan(0);
  });
});
