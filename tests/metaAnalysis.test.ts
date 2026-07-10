import { describe, it, expect } from "vitest";
import { metaAnalyze, type StudyEffectInput } from "../lib/metaAnalysis";

// Oracle test: locks the pooling engine to the closed-form inverse-variance /
// DerSimonian–Laird values that metafor & RevMan implement. The three-study
// fixture below was computed by hand from the exact DL formulas; every pooled
// estimate, weight, and heterogeneity statistic is checked against it.
//
// Studies (log-RR scale): yi/vi = (ln 0.5, 0.04), (ln 0.8, 0.02), (ln 0.6, 0.03),
// supplied as point + 95% CI so the engine's CI→variance recovery is exercised.
const THREE_STUDIES: StudyEffectInput[] = [
  { label: "Trial A", measure: "RR", point: 0.5, ciLower: 0.338, ciUpper: 0.74 },
  { label: "Trial B", measure: "RR", point: 0.8, ciLower: 0.606, ciUpper: 1.055 },
  { label: "Trial C", measure: "RR", point: 0.6, ciLower: 0.427, ciUpper: 0.843 },
];

describe("metaAnalyze — DerSimonian–Laird oracle (3-study fixture)", () => {
  const r = metaAnalyze(THREE_STUDIES)!;

  it("returns a result over all three studies with none skipped", () => {
    expect(r).not.toBeNull();
    expect(r.k).toBe(3);
    expect(r.skipped).toHaveLength(0);
    expect(r.measure).toBe("RR");
  });

  it("fixed-effect pooled RR ≈ 0.657 (95% CI 0.544–0.793)", () => {
    expect(r.fixed.point).toBeCloseTo(0.657, 2);
    expect(r.fixed.ciLower).toBeCloseTo(0.544, 2);
    expect(r.fixed.ciUpper).toBeCloseTo(0.793, 2);
    expect(r.fixed.significant).toBe(true);
  });

  it("random-effects pooled RR ≈ 0.638 (95% CI 0.485–0.840)", () => {
    expect(r.random.point).toBeCloseTo(0.638, 2);
    expect(r.random.ciLower).toBeCloseTo(0.485, 2);
    expect(r.random.ciUpper).toBeCloseTo(0.84, 2);
    expect(r.random.reductionPercent).toBeCloseTo(36.2, 0);
  });

  it("heterogeneity Q≈4.078, df=2, I²≈51%, τ²≈0.030, p≈0.13", () => {
    expect(r.heterogeneity.q).toBeCloseTo(4.078, 1);
    expect(r.heterogeneity.df).toBe(2);
    expect(r.heterogeneity.iSquared).toBeCloseTo(51, 0);
    expect(r.heterogeneity.tauSquared).toBeCloseTo(0.03, 2);
    expect(r.heterogeneity.pValue).toBeCloseTo(0.13, 1);
  });

  it("per-study fixed weights sum to ~100% and match inverse-variance shares", () => {
    const total = r.studies.reduce((a, s) => a + s.weightFixedPct, 0);
    expect(total).toBeCloseTo(100, 0);
    // Trial B has the smallest variance (0.02) → the largest weight.
    expect(r.studies[1].weightFixedPct).toBeGreaterThan(r.studies[0].weightFixedPct);
    expect(r.studies[1].weightFixedPct).toBeCloseTo(46.2, 0);
  });

  it("random-effects weights are more equal than fixed (shrinkage toward equality)", () => {
    const fixedSpread = r.studies[1].weightFixedPct - r.studies[0].weightFixedPct;
    const randomSpread = r.studies[1].weightRandomPct - r.studies[0].weightRandomPct;
    expect(randomSpread).toBeLessThan(fixedSpread);
  });

  it("provides a 95% prediction interval that brackets the pooled estimate", () => {
    expect(r.predictionInterval).not.toBeNull();
    expect(r.predictionInterval!.lower).toBeLessThan(r.random.point);
    expect(r.predictionInterval!.upper).toBeGreaterThan(r.random.point);
  });
});

describe("metaAnalyze — homogeneous studies", () => {
  it("identical effects → I²=0, τ²=0, fixed≈random", () => {
    const same: StudyEffectInput[] = [
      { label: "A", measure: "HR", point: 0.7, ciLower: 0.6, ciUpper: 0.82 },
      { label: "B", measure: "HR", point: 0.7, ciLower: 0.6, ciUpper: 0.82 },
    ];
    const r = metaAnalyze(same)!;
    expect(r.heterogeneity.iSquared).toBe(0);
    expect(r.heterogeneity.tauSquared).toBe(0);
    expect(r.fixed.point).toBeCloseTo(r.random.point, 3);
    expect(r.fixed.point).toBeCloseTo(0.7, 2);
  });
});

describe("metaAnalyze — raw 2x2 counts (RR and OR)", () => {
  it("pools RR studies supplied as counts", () => {
    const counts: StudyEffectInput[] = [
      { label: "A", measure: "RR", events1: 15, total1: 100, events2: 30, total2: 100 },
      { label: "B", measure: "RR", events1: 20, total1: 200, events2: 35, total2: 200 },
    ];
    const r = metaAnalyze(counts)!;
    expect(r.k).toBe(2);
    expect(r.fixed.point).toBeLessThan(1);
    expect(r.studies[0].point).toBeCloseTo(0.5, 2);
  });

  it("computes OR from counts via 1/a+1/b+1/c+1/d", () => {
    const counts: StudyEffectInput[] = [
      { label: "A", measure: "OR", events1: 20, total1: 100, events2: 40, total2: 100 },
      { label: "B", measure: "OR", events1: 25, total1: 120, events2: 45, total2: 120 },
    ];
    const r = metaAnalyze(counts)!;
    expect(r.measure).toBe("OR");
    // OR for 20/80 vs 40/60 = (20*60)/(80*40) = 0.375
    expect(r.studies[0].point).toBeCloseTo(0.375, 2);
  });

  it("skips HR supplied as counts (needs time-to-event data)", () => {
    const bad: StudyEffectInput[] = [
      { label: "A", measure: "HR", point: 0.7, ciLower: 0.6, ciUpper: 0.82 },
      { label: "B", measure: "HR", events1: 10, total1: 100, events2: 20, total2: 100 },
    ];
    const r = metaAnalyze(bad);
    // Only one usable study remains → not a meta-analysis.
    expect(r).toBeNull();
  });
});

describe("metaAnalyze — guard rails", () => {
  it("returns null for fewer than two usable studies", () => {
    expect(metaAnalyze([])).toBeNull();
    expect(
      metaAnalyze([{ label: "A", measure: "RR", point: 0.5, ciLower: 0.3, ciUpper: 0.8 }])
    ).toBeNull();
  });

  it("drops studies whose measure differs from the pool, with a reason", () => {
    const mixed: StudyEffectInput[] = [
      { label: "A", measure: "RR", point: 0.5, ciLower: 0.3, ciUpper: 0.8 },
      { label: "B", measure: "RR", point: 0.6, ciLower: 0.4, ciUpper: 0.9 },
      { label: "C", measure: "OR", point: 0.5, ciLower: 0.3, ciUpper: 0.8 },
    ];
    const r = metaAnalyze(mixed)!;
    expect(r.k).toBe(2);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].label).toBe("C");
    expect(r.skipped[0].reason).toMatch(/Measure OR differs/);
  });

  it("drops a study with an invalid CI rather than crashing", () => {
    const bad: StudyEffectInput[] = [
      { label: "A", measure: "RR", point: 0.5, ciLower: 0.3, ciUpper: 0.8 },
      { label: "B", measure: "RR", point: 0.6, ciLower: 0.4, ciUpper: 0.9 },
      { label: "C", measure: "RR", point: 0.5, ciLower: 0.8, ciUpper: 0.3 },
    ];
    const r = metaAnalyze(bad)!;
    expect(r.k).toBe(2);
    expect(r.skipped[0].label).toBe("C");
  });
});
