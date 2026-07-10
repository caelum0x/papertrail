import { describe, it, expect } from "vitest";
import { assessBodyRiskOfBias } from "../lib/riskOfBiasAdapter";
import type { RiskOfBiasInput } from "../lib/riskOfBias";

// A clean, well-conducted RCT — should contribute a 0-step downgrade.
const CLEAN: RiskOfBiasInput = {
  randomSequenceGenerated: true,
  allocationConcealed: true,
  blinding: "double_blind",
  outcomeAssessorBlinded: true,
  outcomeType: "objective",
  attritionRate: 0.02,
  intentionToTreat: true,
  preRegistered: true,
  allPrespecifiedOutcomesReported: true,
};

// A trial with TWO critical domains at 'high' (no randomization, no allocation
// concealment) — the engine caps risk-of-bias at 2 steps.
const HIGH_RISK: RiskOfBiasInput = {
  ...CLEAN,
  randomSequenceGenerated: false,
  allocationConcealed: false,
};

describe("assessBodyRiskOfBias (adapter oracle sanity)", () => {
  it("a single clean trial contributes no downgrade", () => {
    const body = assessBodyRiskOfBias(CLEAN);
    expect(body.riskOfBiasSteps).toBe(0);
    expect(body.overall).toBe("low");
    expect(body.perStudy).toHaveLength(1);
  });

  it("takes the MAX step count across a mixed body of evidence", () => {
    const body = assessBodyRiskOfBias([
      { label: "Clean", input: CLEAN },
      { label: "Weak", input: HIGH_RISK },
    ]);
    // The weakest contributor (2 high critical domains) drives the body downgrade.
    expect(body.riskOfBiasSteps).toBe(2);
    expect(body.overall).toBe("high");
    expect(body.perStudy).toHaveLength(2);
    // Never exceeds the GRADE per-domain cap.
    expect(body.riskOfBiasSteps).toBeLessThanOrEqual(2);
  });
});
