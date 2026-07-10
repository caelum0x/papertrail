import { describe, it, expect } from "vitest";
import {
  assessRiskOfBias,
  type RiskOfBiasInput,
  type RobJudgement,
} from "../lib/riskOfBias";

// A clean, well-conducted RCT: randomized, concealed, double-blind with a blinded
// assessor, negligible attrition under ITT, pre-registered with all outcomes
// reported, adequate N, ran to completion, publicly funded. Cases override only
// the fields they exercise.
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
  sampleSize: 2000,
  stoppedEarlyForBenefit: false,
  funding: "public",
};

interface Case {
  name: string;
  input: RiskOfBiasInput;
  overall: RobJudgement;
  gradeSteps: number;
}

const CASES: Case[] = [
  {
    name: "clean well-conducted RCT -> low / 0 steps",
    input: { ...CLEAN },
    overall: "low",
    gradeSteps: 0,
  },
  {
    name: "one high critical domain (no concealment) -> high / 1 step",
    input: { ...CLEAN, allocationConcealed: false },
    overall: "high",
    gradeSteps: 1,
  },
  {
    name: "two high critical domains (no randomization + high attrition, no ITT) -> high / 2 steps",
    input: {
      ...CLEAN,
      randomSequenceGenerated: false,
      attritionRate: 0.4,
      intentionToTreat: false,
    },
    overall: "high",
    gradeSteps: 2,
  },
];

describe("assessRiskOfBias — deterministic RoB -> GRADE step reduction", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const result = assessRiskOfBias(c.input);
      expect(result.overall).toBe(c.overall);
      expect(result.gradeSteps).toBe(c.gradeSteps);
      // gradeSteps stays within the GRADE per-domain cap.
      expect(result.gradeSteps).toBeGreaterThanOrEqual(0);
      expect(result.gradeSteps).toBeLessThanOrEqual(2);
      // Every domain carries a non-empty reason.
      for (const d of result.domains) {
        expect(d.reason.length).toBeGreaterThan(0);
      }
    });
  }

  it("does not mutate its input", () => {
    const input: RiskOfBiasInput = { ...CLEAN, allocationConcealed: false };
    const snapshot = JSON.stringify(input);
    assessRiskOfBias(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
