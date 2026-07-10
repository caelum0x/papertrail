import { describe, it, expect } from "vitest";
import {
  ciZ,
  chiSquareSurvival,
  studentTCdf,
  studentTInverse,
  incompleteBeta,
} from "../lib/stats/distributions";

// Oracle tests: lock our hand-rolled special functions to accepted reference
// values (R's pchisq/qt/pbeta, standard statistical tables). This converts
// "we wrote the distributions ourselves" into "our numbers equal the standard
// tools' numbers" — the same discipline as the biostatistics oracle.

describe("ciZ — normal quantile for CIs", () => {
  it("95% CI → z ≈ 1.95996", () => {
    expect(ciZ(95)).toBeCloseTo(1.95996, 4);
  });
  it("90% CI → z ≈ 1.64485", () => {
    expect(ciZ(90)).toBeCloseTo(1.64485, 4);
  });
  it("99% CI → z ≈ 2.57583", () => {
    expect(ciZ(99)).toBeCloseTo(2.57583, 4);
  });
});

describe("chiSquareSurvival — Cochran's Q p-value (matches R pchisq lower=F)", () => {
  it("x=4.0779, df=2 → p ≈ 0.1302", () => {
    expect(chiSquareSurvival(4.0779, 2)).toBeCloseTo(0.1302, 3);
  });
  it("x=3.841, df=1 → p ≈ 0.05 (the 95% critical value)", () => {
    expect(chiSquareSurvival(3.841, 1)).toBeCloseTo(0.05, 3);
  });
  it("x=11.07, df=5 → p ≈ 0.05", () => {
    expect(chiSquareSurvival(11.07, 5)).toBeCloseTo(0.05, 3);
  });
  it("x=0 → p = 1", () => {
    expect(chiSquareSurvival(0, 3)).toBe(1);
  });
});

describe("studentTInverse — t quantiles (matches R qt)", () => {
  it("p=0.975, df=1 → 12.706", () => {
    expect(studentTInverse(0.975, 1)).toBeCloseTo(12.706, 2);
  });
  it("p=0.975, df=10 → 2.2281", () => {
    expect(studentTInverse(0.975, 10)).toBeCloseTo(2.2281, 3);
  });
  it("p=0.975, df=30 → 2.0423", () => {
    expect(studentTInverse(0.975, 30)).toBeCloseTo(2.0423, 3);
  });
  it("large df → approaches the normal quantile 1.95996", () => {
    expect(studentTInverse(0.975, 100000)).toBeCloseTo(1.95996, 3);
  });
});

describe("studentTCdf / incompleteBeta — internal consistency", () => {
  it("t CDF is symmetric about 0", () => {
    expect(studentTCdf(1.5, 8) + studentTCdf(-1.5, 8)).toBeCloseTo(1, 6);
  });
  it("t CDF and inverse round-trip", () => {
    const t = studentTInverse(0.9, 12);
    expect(studentTCdf(t, 12)).toBeCloseTo(0.9, 4);
  });
  it("incompleteBeta(0.5, 1, 1) = 0.5 (uniform)", () => {
    expect(incompleteBeta(0.5, 1, 1)).toBeCloseTo(0.5, 6);
  });
});
