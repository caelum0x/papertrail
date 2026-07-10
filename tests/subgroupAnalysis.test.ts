import { describe, it, expect } from "vitest";
import {
  subgroupAnalysis,
  verifyAgainstSubgroups,
  type Subgroup,
} from "../lib/subgroupAnalysis";
import type { StudyEffectInput } from "../lib/metaAnalysis";

function study(label: string, point: number, ciLower: number, ciUpper: number): StudyEffectInput {
  return { label, measure: "HR", point, ciLower, ciUpper };
}

// Two subgroups with clearly DIFFERENT effects: a strong ~40% reduction in the
// biomarker-positive subgroup vs essentially no effect (HR ~1.0) in the
// biomarker-negative subgroup. Tight CIs make the between-group difference
// significant → a real effect modification.
const HETEROGENEOUS: Subgroup[] = [
  {
    name: "Biomarker-positive",
    studies: [study("A1", 0.6, 0.52, 0.69), study("A2", 0.62, 0.54, 0.71)],
  },
  {
    name: "Biomarker-negative",
    studies: [study("B1", 0.99, 0.9, 1.09), study("B2", 1.01, 0.92, 1.11)],
  },
];

// Two subgroups with the SAME modest effect → homogeneous, no interaction.
const HOMOGENEOUS: Subgroup[] = [
  {
    name: "Under 65",
    studies: [study("C1", 0.8, 0.7, 0.91), study("C2", 0.82, 0.72, 0.93)],
  },
  {
    name: "65 and over",
    studies: [study("D1", 0.81, 0.71, 0.92), study("D2", 0.79, 0.69, 0.9)],
  },
];

describe("subgroupAnalysis — test for subgroup differences", () => {
  it("detects a significant interaction between clearly different subgroups", () => {
    const r = subgroupAnalysis(HETEROGENEOUS);
    expect(r.subgroups).toHaveLength(2);
    expect(r.df).toBe(1);
    expect(r.qBetween).toBeGreaterThan(3.84); // χ²(1) crit at α=0.05
    expect(r.interactionSignificant).toBe(true);
    expect(r.overall).not.toBeNull();
  });

  it("flags a claim matching only the strong subgroup as subgroup_only_effect", () => {
    // ~40% reduction matches Biomarker-positive (HR ~0.61) but not the overall pool.
    const v = verifyAgainstSubgroups("The drug reduced events by 40%.", HETEROGENEOUS);
    expect(v.verdict).toBe("subgroup_only_effect");
    expect(v.matchedSubgroup).toBe("Biomarker-positive");
    expect(v.claimedReductionPercent).toBeCloseTo(40, 0);
  });

  it("returns no_interaction for homogeneous subgroups", () => {
    const r = subgroupAnalysis(HOMOGENEOUS);
    expect(r.interactionSignificant).toBe(false);
    const v = verifyAgainstSubgroups("The drug reduced events by about 20%.", HOMOGENEOUS);
    expect(v.verdict).toBe("no_interaction");
  });
});
