import { describe, it, expect } from "vitest";
import { absoluteFromRelative, formatAbsolute } from "../lib/absoluteEffects";

// Oracle test: locks the absolute-effect translation to values computed by hand from
// the closed forms (the same numbers a GRADE "assumed vs corresponding risk" table
// produces). No LLM, no randomness — every value is a function of the four inputs.

describe("absoluteFromRelative — RR 0.75 at 10% baseline (canonical oracle)", () => {
  const r = absoluteFromRelative({
    measure: "RR",
    point: 0.75,
    ciLower: 0.6,
    ciUpper: 0.9,
    baselineRisk: 0.1,
  })!;

  it("treated risk 0.075, ARR 0.025, NNT 40", () => {
    expect(r).not.toBeNull();
    expect(r.riskTreated).toBeCloseTo(0.075, 4);
    expect(r.absoluteRiskReduction).toBeCloseTo(0.025, 4);
    expect(r.nnt).toBeCloseTo(40, 1);
    expect(r.direction).toBe("benefit");
  });

  it("events per 1000: 100 control -> 75 treated (25 fewer)", () => {
    expect(r.eventsPer1000Control).toBe(100);
    expect(r.eventsPer1000Treated).toBe(75);
  });

  it("ARR CI (from RR CI 0.60-0.90) is 0.010 to 0.040, NNT CI 25 to 100", () => {
    expect(r.arrCiLower).toBeCloseTo(0.01, 4);
    expect(r.arrCiUpper).toBeCloseTo(0.04, 4);
    expect(r.nntCiLower).toBeCloseTo(25, 1);
    expect(r.nntCiUpper).toBeCloseTo(100, 1);
  });

  it("formats a plain-language benefit sentence", () => {
    expect(formatAbsolute(r)).toBe(
      "For every 1000 patients treated, ~25 fewer events (NNT 40 to prevent one event)."
    );
  });
});

describe("absoluteFromRelative — OR 0.5 at 20% baseline (odds conversion)", () => {
  const r = absoluteFromRelative({
    measure: "OR",
    point: 0.5,
    ciLower: 0.4,
    ciUpper: 0.6,
    baselineRisk: 0.2,
  })!;

  // oddsC = 0.2/0.8 = 0.25; oddsT = 0.125; riskT = 0.125/1.125 = 0.1111...
  it("converts via odds, not risk (treated risk 0.111, not 0.10)", () => {
    expect(r.riskTreated).toBeCloseTo(0.1111, 3);
    expect(r.absoluteRiskReduction).toBeCloseTo(0.0889, 3);
    expect(r.direction).toBe("benefit");
  });
});

describe("absoluteFromRelative — RR 1.5 at 10% baseline (harm -> NNH)", () => {
  const r = absoluteFromRelative({
    measure: "RR",
    point: 1.5,
    ciLower: 1.2,
    ciUpper: 1.8,
    baselineRisk: 0.1,
  })!;

  it("negative ARR, sign-aware NNH (-20), harm direction", () => {
    expect(r.riskTreated).toBeCloseTo(0.15, 4);
    expect(r.absoluteRiskReduction).toBeCloseTo(-0.05, 4);
    expect(r.nnt).toBeCloseTo(-20, 1);
    expect(r.direction).toBe("harm");
  });

  it("formats a harm sentence with NNH", () => {
    expect(formatAbsolute(r)).toBe(
      "For every 1000 patients treated, ~50 more events (NNH 20 to cause one additional event)."
    );
  });
});

describe("absoluteFromRelative — guards", () => {
  it("returns null for baseline risk out of (0,1)", () => {
    expect(absoluteFromRelative({ measure: "RR", point: 0.75, ciLower: 0.6, ciUpper: 0.9, baselineRisk: 0 })).toBeNull();
    expect(absoluteFromRelative({ measure: "RR", point: 0.75, ciLower: 0.6, ciUpper: 0.9, baselineRisk: 1 })).toBeNull();
  });

  it("returns null for non-positive relative effect", () => {
    expect(absoluteFromRelative({ measure: "RR", point: 0, ciLower: 0.6, ciUpper: 0.9, baselineRisk: 0.1 })).toBeNull();
  });
});
