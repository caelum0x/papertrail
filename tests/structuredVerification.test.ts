import { describe, it, expect } from "vitest";
import { checkAgainstRegistry } from "../lib/structuredVerification";
import { TrialResultAnalysis } from "../lib/sources/clinicaltrials";

function analysis(over: Partial<TrialResultAnalysis>): TrialResultAnalysis {
  return {
    outcomeTitle: "Primary composite outcome",
    outcomeType: "PRIMARY",
    paramType: "Hazard Ratio (HR)",
    paramValue: 0.75,
    ciPct: 95,
    ciLower: 0.64,
    ciUpper: 0.89,
    pValue: "<0.001",
    method: "Cox",
    ...over,
  };
}

describe("checkAgainstRegistry", () => {
  it("flags a claim that overstates the registered effect", () => {
    const r = checkAgainstRegistry("The drug cut cardiovascular risk in half.", [analysis({})]);
    expect(r.verdict).toBe("overstates_registry");
    expect(r.registeredReductionPercent).toBe(25);
    expect(r.claimedReductionPercent).toBe(50);
    expect(r.rationale).toContain("0.75");
  });

  it("matches when the claimed magnitude agrees with the registry", () => {
    const r = checkAgainstRegistry("Treatment reduced events by about 25%.", [analysis({})]);
    expect(r.verdict).toBe("matches_registry");
  });

  it("flags a significance mismatch when the registered CI crosses the null", () => {
    const r = checkAgainstRegistry("The drug significantly reduced events.", [
      analysis({ paramValue: 0.9, ciLower: 0.78, ciUpper: 1.1, pValue: "0.2" }),
    ]);
    expect(r.verdict).toBe("significance_mismatch");
  });

  it("reports no_registered_results when the trial has none", () => {
    const r = checkAgainstRegistry("The drug reduced events by 30%.", []);
    expect(r.verdict).toBe("no_registered_results");
    expect(r.primaryAnalysis).toBeNull();
  });

  it("is not_comparable when the registered analysis is not a ratio measure", () => {
    const r = checkAgainstRegistry("The drug reduced events by 30%.", [
      analysis({ paramType: "Mean Difference", paramValue: -1.2, ciLower: -2.0, ciUpper: -0.4 }),
    ]);
    expect(r.verdict).toBe("not_comparable");
  });

  it("prefers the PRIMARY ratio outcome over secondary ones", () => {
    const r = checkAgainstRegistry("The drug reduced events by about 25%.", [
      analysis({ outcomeType: "SECONDARY", paramValue: 0.5, outcomeTitle: "secondary" }),
      analysis({ outcomeType: "PRIMARY", paramValue: 0.75, outcomeTitle: "primary" }),
    ]);
    expect(r.primaryAnalysis?.outcomeTitle).toBe("primary");
    expect(r.verdict).toBe("matches_registry");
  });

  it("surfaces absolute risk reduction and NNT from the raw registered counts", () => {
    const r = checkAgainstRegistry("Treatment reduced events by about 25%.", [
      analysis({ absoluteRiskReduction: 1.6, numberNeededToTreat: 62 }),
    ]);
    expect(r.verdict).toBe("matches_registry");
    expect(r.absoluteRiskReduction).toBe(1.6);
    expect(r.numberNeededToTreat).toBe(62);
    expect(r.rationale).toContain("absolute risk reduction");
  });

  it("flags a secondary-endpoint match when the claim fits a secondary, not the primary", () => {
    const r = checkAgainstRegistry("The drug cut cardiovascular events in half.", [
      analysis({ outcomeType: "PRIMARY", paramValue: 0.9, outcomeTitle: "primary composite" }),
      analysis({
        outcomeType: "SECONDARY",
        paramValue: 0.5,
        ciLower: 0.3,
        ciUpper: 0.8,
        outcomeTitle: "all-cause mortality",
      }),
    ]);
    expect(r.verdict).toBe("secondary_endpoint_match");
    expect(r.rationale).toContain("all-cause mortality");
  });
});
