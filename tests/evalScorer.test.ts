import { describe, it, expect } from "vitest";
import {
  scoreCase,
  scoreToBand,
  expectedBandFor,
  spansCoverExpected,
} from "@/lib/eval/scorer";
import type { PredictedResult, ExpectedResult } from "@/lib/eval/types";

function predicted(overrides: Partial<PredictedResult> = {}): PredictedResult {
  return {
    discrepancyType: "accurate",
    trustScore: 95,
    trustBand: "high",
    flaggedSourceSpans: [],
    matchedSourceExternalId: "NCT01",
    error: null,
    ...overrides,
  };
}

function expected(overrides: Partial<ExpectedResult> = {}): ExpectedResult {
  return {
    discrepancyType: "accurate",
    expectedSubstrings: [],
    ...overrides,
  };
}

describe("scoreToBand", () => {
  it("bands high/moderate/low at the cut points", () => {
    expect(scoreToBand(95)).toBe("high");
    expect(scoreToBand(90)).toBe("high");
    expect(scoreToBand(89)).toBe("moderate");
    expect(scoreToBand(60)).toBe("moderate");
    expect(scoreToBand(59)).toBe("low");
    expect(scoreToBand(0)).toBe("low");
  });

  it("clamps out-of-range and NaN scores defensively", () => {
    expect(scoreToBand(150)).toBe("high");
    expect(scoreToBand(-10)).toBe("low");
    expect(scoreToBand(Number.NaN)).toBe("low");
  });
});

describe("expectedBandFor", () => {
  it("maps labels to their implied trust band", () => {
    expect(expectedBandFor("accurate")).toBe("high");
    expect(expectedBandFor("no_support_found")).toBe("low");
    expect(expectedBandFor("magnitude_overstated")).toBe("moderate");
    expect(expectedBandFor("population_overgeneralized")).toBe("moderate");
    expect(expectedBandFor("caveat_dropped")).toBe("moderate");
  });
});

describe("spansCoverExpected", () => {
  it("returns true when there are no expected substrings", () => {
    expect(spansCoverExpected([], [])).toBe(true);
  });

  it("matches case- and whitespace-insensitively within a flagged span", () => {
    expect(
      spansCoverExpected(
        ["Patients   65 and OLDER with prior MI"],
        ["patients 65 and older"]
      )
    ).toBe(true);
  });

  it("requires every expected substring to be covered by some span", () => {
    expect(
      spansCoverExpected(["only this one"], ["only this one", "missing"])
    ).toBe(false);
  });

  it("fails when no flagged spans are present but substrings are expected", () => {
    expect(spansCoverExpected([], ["something"])).toBe(false);
  });
});

describe("scoreCase", () => {
  it("passes when type, band, and spans all match", () => {
    const score = scoreCase(
      predicted({
        discrepancyType: "magnitude_overstated",
        trustScore: 45,
        trustBand: "moderate",
        flaggedSourceSpans: ["reduced events by 12%"],
      }),
      expected({
        discrepancyType: "magnitude_overstated",
        expectedSubstrings: ["reduced events by 12%"],
      })
    );
    expect(score).toEqual({
      passed: true,
      discrepancyMatch: true,
      spanGrounded: true,
      spanGroundingApplicable: true,
      trustBandMatch: true,
    });
  });

  it("fails when the discrepancy type is wrong even if band matches", () => {
    const score = scoreCase(
      predicted({ discrepancyType: "caveat_dropped", trustScore: 70, trustBand: "moderate" }),
      expected({ discrepancyType: "magnitude_overstated" })
    );
    expect(score.discrepancyMatch).toBe(false);
    expect(score.passed).toBe(false);
  });

  it("fails when the trust band disagrees with the expected label", () => {
    const score = scoreCase(
      predicted({ discrepancyType: "accurate", trustScore: 40, trustBand: "low" }),
      expected({ discrepancyType: "accurate" })
    );
    expect(score.trustBandMatch).toBe(false);
    expect(score.passed).toBe(false);
  });

  it("fails when expected spans are not grounded", () => {
    const score = scoreCase(
      predicted({
        discrepancyType: "caveat_dropped",
        trustScore: 70,
        trustBand: "moderate",
        flaggedSourceSpans: ["something unrelated"],
      }),
      expected({
        discrepancyType: "caveat_dropped",
        expectedSubstrings: ["not present in the span"],
      })
    );
    expect(score.spanGrounded).toBe(false);
    expect(score.passed).toBe(false);
  });

  it("treats span grounding as satisfied when the case declares no substrings", () => {
    const score = scoreCase(
      predicted({ discrepancyType: "accurate", trustScore: 95, trustBand: "high" }),
      expected({ discrepancyType: "accurate", expectedSubstrings: [] })
    );
    expect(score.spanGroundingApplicable).toBe(false);
    expect(score.spanGrounded).toBe(true);
    expect(score.passed).toBe(true);
  });

  it("fails every dimension on an errored prediction", () => {
    const score = scoreCase(
      predicted({ discrepancyType: null, trustScore: null, trustBand: null, error: "boom" }),
      expected({ discrepancyType: "accurate" })
    );
    expect(score).toEqual({
      passed: false,
      discrepancyMatch: false,
      spanGrounded: false,
      spanGroundingApplicable: false,
      trustBandMatch: false,
    });
  });

  it("derives the band from trustScore when trustBand is absent", () => {
    const score = scoreCase(
      predicted({
        discrepancyType: "no_support_found",
        trustScore: 10,
        trustBand: null,
        flaggedSourceSpans: [],
      }),
      expected({ discrepancyType: "no_support_found" })
    );
    expect(score.trustBandMatch).toBe(true);
    expect(score.passed).toBe(true);
  });
});
