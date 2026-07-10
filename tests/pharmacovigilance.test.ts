import { describe, it, expect } from "vitest";
import { disproportionality } from "../lib/bio/pharmacovigilance";

// Oracle test: locks the FAERS disproportionality statistics to hand-computed
// reference values for a fixed drug–event 2x2 (a=25, b=1000, c=200, d=50000).
//   PRR = (a/(a+b)) / (c/(c+d)) = (25/1025)/(200/50200) ≈ 6.12
//   ROR = (a*d)/(b*c) = (25*50000)/(1000*200) = 6.25 exactly
//   IC  = log2( a*n / ((a+b)(a+c)) ) = log2(25*51225 / (1025*225)) ≈ 2.47
//   chi² (Pearson) = n(ad-bc)² / ((a+b)(c+d)(a+c)(b+d)) ≈ 95.6
// This is the same discipline as tests/biostatsOracle.test.ts — "we wrote the
// pharmacovigilance math ourselves" becomes "our numbers equal the standard ones."
describe("disproportionality — FAERS signal oracle", () => {
  const r = disproportionality({ a: 25, b: 1000, c: 200, d: 50000 })!;

  it("returns a result for a well-formed 2x2", () => {
    expect(r).not.toBeNull();
    expect(r.n).toBe(51225);
  });

  it("PRR ≈ 6.12", () => {
    expect(r.prr).toBeCloseTo(6.12, 1);
    expect(r.prrCiLower).toBeLessThan(r.prr);
    expect(r.prrCiUpper).toBeGreaterThan(r.prr);
  });

  it("ROR = 6.25 exactly", () => {
    expect(r.ror).toBeCloseTo(6.25, 2);
  });

  it("Information Component ≈ 2.47", () => {
    expect(r.informationComponent).toBeCloseTo(2.47, 1);
    expect(r.ic025).toBeLessThan(r.informationComponent);
  });

  it("Pearson chi-square ≈ 95.6, Yates slightly lower, both well above 4", () => {
    expect(r.chiSquared).toBeCloseTo(95.6, 0);
    expect(r.chiSquaredYates).toBeLessThan(r.chiSquared);
    expect(r.chiSquaredYates).toBeGreaterThan(4);
  });

  it("fires a signal (PRR≥2 AND a≥3 AND Yates χ²≥4)", () => {
    expect(r.signal).toBe(true);
  });

  it("a below-threshold table does NOT fire a signal", () => {
    // Roughly proportional reporting → PRR near 1.
    const weak = disproportionality({ a: 10, b: 1000, c: 100, d: 10000 })!;
    expect(weak.prr).toBeCloseTo(1, 0);
    expect(weak.signal).toBe(false);
  });

  it("returns null for a degenerate (empty) table", () => {
    expect(disproportionality({ a: 0, b: 0, c: 0, d: 0 })).toBeNull();
  });
});
