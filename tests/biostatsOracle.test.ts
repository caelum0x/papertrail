import { describe, it, expect } from "vitest";
import { riskRatioFromCounts } from "../lib/biostats";

// Oracle test: locks our hand-rolled log-RR (Katz) 2x2 CI to accepted epidemiology
// reference values as computed by epitools (CRAN) / OpenEpi. This converts "we wrote
// the biostatistics ourselves" into "our numbers equal the standard tools'."
describe("riskRatioFromCounts — epidemiology oracle", () => {
  it("15/100 vs 30/100 → RR 0.50, 95% CI ~0.29–0.87 (matches epitools)", () => {
    const r = riskRatioFromCounts(15, 100, 30, 100)!;
    expect(r).not.toBeNull();
    expect(r.riskRatio).toBeCloseTo(0.5, 3);
    expect(r.ciLower).toBeCloseTo(0.29, 2);
    expect(r.ciUpper).toBeCloseTo(0.87, 2);
    expect(r.reductionPercent).toBeCloseTo(50, 1);
    expect(r.significant).toBe(true);
  });

  it("50/1000 vs 100/1000 → RR 0.50, CI excludes 1 (significant)", () => {
    const r = riskRatioFromCounts(50, 1000, 100, 1000)!;
    expect(r.riskRatio).toBeCloseTo(0.5, 3);
    expect(r.ciUpper).toBeLessThan(1);
    expect(r.significant).toBe(true);
  });

  it("100/1000 vs 110/1000 → CI crosses 1 (not significant)", () => {
    const r = riskRatioFromCounts(100, 1000, 110, 1000)!;
    expect(r.ciLower).toBeLessThan(1);
    expect(r.ciUpper).toBeGreaterThan(1);
    expect(r.significant).toBe(false);
  });

  it("applies a continuity correction for a zero event cell without throwing", () => {
    const r = riskRatioFromCounts(0, 100, 10, 100)!;
    expect(r).not.toBeNull();
    expect(r.riskRatio).toBeGreaterThan(0);
    expect(r.riskRatio).toBeLessThan(1);
  });

  it("zero events in BOTH arms → RR ~1.0 with a very wide, null-crossing CI", () => {
    // Documents the double-zero edge case: after the Haldane–Anscombe correction
    // a=c=0.5 and n1=n2=101, so RR = (0.5/101)/(0.5/101) = 1.0 exactly. SE(ln RR)
    // = sqrt(1/0.5 - 1/101 + 1/0.5 - 1/101) ≈ 1.995, giving CI ≈ 0.02–54.6 on the
    // ratio scale — the null of no difference is preserved despite extreme uncertainty.
    const r = riskRatioFromCounts(0, 100, 0, 100)!;
    expect(r).not.toBeNull();
    expect(r.riskRatio).toBeCloseTo(1.0, 3);
    expect(r.reductionPercent).toBeCloseTo(0, 1);
    // Very wide CI: lower well below 1, upper far above 1.
    expect(r.ciLower).toBeCloseTo(0.02, 2);
    expect(r.ciUpper).toBeGreaterThan(45);
    expect(r.ciLower).toBeLessThan(1);
    expect(r.ciUpper).toBeGreaterThan(1);
    expect(r.significant).toBe(false);
  });

  it("returns null for unusable inputs", () => {
    expect(riskRatioFromCounts(5, 0, 3, 10)).toBeNull();
    expect(riskRatioFromCounts(-1, 10, 2, 10)).toBeNull();
    expect(riskRatioFromCounts(20, 10, 2, 10)).toBeNull(); // events > total
  });
});
