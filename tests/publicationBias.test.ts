import { describe, it, expect } from "vitest";
import {
  eggersTest,
  funnelPlotData,
  interpret,
  trimAndFill,
  type StudyEffect,
} from "../lib/publicationBias";

// Oracle test: locks Egger's regression to the closed form implemented by
// metafor's regtest / RevMan. Egger's test is an OLS regression of each study's
// standard normal deviate (SND = yi/se) on its precision (1/se); a non-zero
// INTERCEPT signals funnel-plot asymmetry.
//
// The ASYMMETRIC fixture below (se = 0.1, 0.2, 0.3, 0.4; effect grows as
// precision falls — the classic small-study pattern) was computed by hand:
//   precision x = (10, 5, 3.3333, 2.5), SND y = (1, 1.5, 1.6667, 2)
//   OLS  → slope = -0.12, intercept = 2.166667
//   Sxx = 30.7222, meanX = 5.20833
//   residual s^2 → SE(intercept) = 0.1323683
//   t = 2.166667 / 0.1323683 = 16.36847,  df = 2
//   two-sided p = 2*(1 - T_2(16.36847)) = 0.0037116
const ASYMMETRIC: StudyEffect[] = [
  { label: "A", yi: 0.1, vi: 0.01 }, // se 0.1
  { label: "B", yi: 0.3, vi: 0.04 }, // se 0.2
  { label: "C", yi: 0.5, vi: 0.09 }, // se 0.3
  { label: "D", yi: 0.8, vi: 0.16 }, // se 0.4
];

describe("eggersTest — asymmetric oracle (4-study fixture)", () => {
  const r = eggersTest(ASYMMETRIC)!;

  it("regresses all four studies with df = k - 2", () => {
    expect(r).not.toBeNull();
    expect(r.k).toBe(4);
    expect(r.df).toBe(2);
  });

  it("intercept ≈ 2.166667 (the small-study bias coefficient)", () => {
    expect(r.intercept).toBeCloseTo(2.166667, 5);
  });

  it("slope ≈ -0.12 (effect shrinks as precision rises)", () => {
    expect(r.slope).toBeCloseTo(-0.12, 6);
  });

  it("SE(intercept) ≈ 0.1323683", () => {
    expect(r.interceptSe).toBeCloseTo(0.1323683, 6);
  });

  it("t ≈ 16.36847", () => {
    expect(r.t).toBeCloseTo(16.36847, 4);
  });

  it("two-sided p ≈ 0.0037116", () => {
    expect(r.pValue).toBeCloseTo(0.0037116, 6);
  });

  it("flags asymmetry (p < 0.10)", () => {
    expect(r.asymmetry).toBe(true);
    expect(interpret(r)).toBe("possible_small_study_effects");
  });
});

describe("eggersTest — symmetric set (no asymmetry)", () => {
  // Effect is CONSTANT across precision (yi = 0.2 for every study), so the funnel
  // is symmetric: SND = 0.2 * precision passes exactly through the origin, giving
  // intercept 0 and no asymmetry.
  const SYMMETRIC: StudyEffect[] = [
    { label: "A", yi: 0.2, vi: 0.01 },
    { label: "B", yi: 0.2, vi: 0.04 },
    { label: "C", yi: 0.2, vi: 0.09 },
    { label: "D", yi: 0.2, vi: 0.16 },
  ];
  const r = eggersTest(SYMMETRIC)!;

  it("intercept ≈ 0", () => {
    expect(r.intercept).toBeCloseTo(0, 6);
  });

  it("slope ≈ 0.2 (the true constant effect)", () => {
    expect(r.slope).toBeCloseTo(0.2, 6);
  });

  it("does not flag asymmetry", () => {
    expect(r.asymmetry).toBe(false);
    expect(interpret(r)).toBe("no_asymmetry");
  });
});

describe("eggersTest — guard rails", () => {
  it("returns null for fewer than three usable studies", () => {
    expect(eggersTest([])).toBeNull();
    expect(eggersTest([{ label: "A", yi: 0.1, vi: 0.01 }])).toBeNull();
    expect(
      eggersTest([
        { label: "A", yi: 0.1, vi: 0.01 },
        { label: "B", yi: 0.2, vi: 0.04 },
      ])
    ).toBeNull();
    expect(interpret(null)).toBe("insufficient_studies");
  });

  it("drops degenerate studies (non-positive / non-finite variance) before counting k", () => {
    // Two usable + one degenerate → only two usable → insufficient.
    const withBad: StudyEffect[] = [
      { label: "A", yi: 0.1, vi: 0.01 },
      { label: "B", yi: 0.2, vi: 0.04 },
      { label: "C", yi: 0.5, vi: 0 },
    ];
    expect(eggersTest(withBad)).toBeNull();
  });

  it("returns null when every study shares the same precision (no spread on x)", () => {
    const flat: StudyEffect[] = [
      { label: "A", yi: 0.1, vi: 0.04 },
      { label: "B", yi: 0.3, vi: 0.04 },
      { label: "C", yi: 0.5, vi: 0.04 },
    ];
    expect(eggersTest(flat)).toBeNull();
  });

  it("does not mutate its input", () => {
    const input: StudyEffect[] = [
      { label: "A", yi: 0.1, vi: 0.01 },
      { label: "B", yi: 0.3, vi: 0.04 },
      { label: "C", yi: 0.5, vi: 0.09 },
    ];
    const snapshot = JSON.stringify(input);
    eggersTest(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("funnelPlotData", () => {
  const pooled = 0.4;
  const data = funnelPlotData(ASYMMETRIC, pooled);

  it("returns one funnel point per usable study with effect/se/deviation", () => {
    expect(data.studies).toHaveLength(4);
    const a = data.studies[0];
    expect(a.effect).toBe(0.1);
    expect(a.se).toBeCloseTo(0.1, 12);
    expect(a.standardError).toBeCloseTo(0.1, 12);
    expect(a.deviation).toBeCloseTo(0.1 - pooled, 12); // -0.3
  });

  it("carries the pooled log effect through", () => {
    expect(data.pooledLogEffect).toBe(pooled);
  });

  it("provides pseudo-95% CI bounds that widen with SE and close at the apex", () => {
    // Widest SE first, apex (se = 0) last, closing on the pooled estimate.
    const base = data.ciBounds[0];
    const apex = data.ciBounds[data.ciBounds.length - 1];
    expect(base.se).toBeCloseTo(0.4, 12); // largest se in the set
    expect(base.lower).toBeCloseTo(pooled - 1.959963984540054 * 0.4, 6);
    expect(base.upper).toBeCloseTo(pooled + 1.959963984540054 * 0.4, 6);
    expect(apex.se).toBe(0);
    expect(apex.lower).toBeCloseTo(pooled, 12);
    expect(apex.upper).toBeCloseTo(pooled, 12);
    // Wider SE ⇒ wider interval.
    expect(base.upper - base.lower).toBeGreaterThan(apex.upper - apex.lower);
  });

  it("drops degenerate studies from the plot", () => {
    const withBad: StudyEffect[] = [
      ...ASYMMETRIC,
      { label: "X", yi: 0.5, vi: -1 },
    ];
    expect(funnelPlotData(withBad, pooled).studies).toHaveLength(4);
  });
});

// Oracle for Duval & Tweedie trim-and-fill (L0 estimator), ported from
// metafor's trimfill algorithm. The fixture uses EQUAL variances (vi = 0.25),
// so every fixed-effect weight is equal and the pooled log effect is just the
// arithmetic mean — every step is hand-checkable.
//
// Observed: yi = 0.0, 0.2, 0.4, 0.6, 1.4  (all vi = 0.25 ⇒ se = 0.5).
//   naive fixed-effect pool = mean = 2.6 / 5 = 0.52  (dragged RIGHT by 1.4).
//   trim-and-fill detects one missing study on the LEFT, trims the 1.4 outlier,
//   converges to a trimmed pool of 0.3, and imputes its mirror image:
//     yi* = 2 * 0.3 - 1.4 = -0.8   (vi = 0.25).
//   adjusted pool = mean(0.0, 0.2, 0.4, 0.6, 1.4, -0.8) = 1.8 / 6 = 0.30,
//   i.e. shifted 0.22 back toward the null.
//   adjusted SE = sqrt(1 / (6 * 4)) = sqrt(1/24) = 0.2041241.
describe("trimAndFill — asymmetric oracle (imputes one study, shifts toward null)", () => {
  const ASYM_TF: StudyEffect[] = [
    { label: "A", yi: 0.0, vi: 0.25 },
    { label: "B", yi: 0.2, vi: 0.25 },
    { label: "C", yi: 0.4, vi: 0.25 },
    { label: "D", yi: 0.6, vi: 0.25 },
    { label: "E", yi: 1.4, vi: 0.25 },
  ];
  const r = trimAndFill(ASYM_TF)!;

  it("imputes k0 = 1 on the left side", () => {
    expect(r).not.toBeNull();
    expect(r.k0Imputed).toBe(1);
    expect(r.side).toBe("left");
  });

  it("mirrors the 1.4 outlier about the trimmed pool (0.3) to yi = -0.8", () => {
    expect(r.imputed).toHaveLength(1);
    expect(r.imputed[0].yi).toBeCloseTo(-0.8, 10);
    expect(r.imputed[0].vi).toBe(0.25);
  });

  it("adjusted pooled log effect = 0.30 (shifted 0.22 toward null from 0.52)", () => {
    expect(r.adjustedPooledLogEffect).toBeCloseTo(0.3, 10);
    expect(r.adjustedPoint).toBeCloseTo(Math.exp(0.3), 10);
  });

  it("adjusted pseudo-95% CI on the exp scale from mu ± 1.96 * sqrt(1/24)", () => {
    const z = 1.959963984540054;
    const se = Math.sqrt(1 / 24);
    expect(r.adjustedCiLower).toBeCloseTo(Math.exp(0.3 - z * se), 10);
    expect(r.adjustedCiUpper).toBeCloseTo(Math.exp(0.3 + z * se), 10);
  });
});

describe("trimAndFill — symmetric set imputes nothing (k0 = 0)", () => {
  // Effects are symmetric about 0, so the L0 estimator returns 0: no fill,
  // and the adjusted pool equals the ordinary fixed-effect pool (0).
  const SYM_TF: StudyEffect[] = [
    { label: "A", yi: -0.4, vi: 0.25 },
    { label: "B", yi: -0.2, vi: 0.25 },
    { label: "C", yi: 0.0, vi: 0.25 },
    { label: "D", yi: 0.2, vi: 0.25 },
    { label: "E", yi: 0.4, vi: 0.25 },
  ];
  const r = trimAndFill(SYM_TF)!;

  it("imputes nothing", () => {
    expect(r.k0Imputed).toBe(0);
    expect(r.side).toBe("none");
    expect(r.imputed).toHaveLength(0);
  });

  it("adjusted pool equals the unadjusted fixed-effect pool (≈ 0)", () => {
    expect(r.adjustedPooledLogEffect).toBeCloseTo(0, 10);
  });

  it("returns null for fewer than three usable studies", () => {
    expect(trimAndFill([{ label: "A", yi: 0.1, vi: 0.01 }])).toBeNull();
  });

  it("does not mutate its input", () => {
    const snapshot = JSON.stringify(SYM_TF);
    trimAndFill(SYM_TF);
    expect(JSON.stringify(SYM_TF)).toBe(snapshot);
  });
});
