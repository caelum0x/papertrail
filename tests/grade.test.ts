import { describe, it, expect } from "vitest";
import {
  gradeCertainty,
  gradeInputSchema,
  type Certainty,
  type DowngradeDomain,
  type GradeInput,
} from "../lib/grade";

// Table-driven certainty ratings. Each row is a pooled-evidence scenario with the
// expected final certainty and the exact set of domains that must be downgraded.
// The engine is deterministic, so these are hard equalities, not approximations.
interface Case {
  name: string;
  input: GradeInput;
  certainty: Certainty;
  // Domains expected to appear in `downgrades`, with their step counts.
  domains: Partial<Record<DowngradeDomain, number>>;
}

// A clean baseline: consistent (low I²), precise (narrow CI, large N), significant,
// no judgement downgrades. Individual cases override the fields they exercise.
const CLEAN: GradeInput = {
  k: 5,
  iSquared: 10,
  point: 0.7,
  ciLower: 0.6,
  ciUpper: 0.82,
  ciCrossesNull: false,
  totalN: 5000,
};

const CASES: Case[] = [
  {
    name: "consistent, precise, significant -> high",
    input: { ...CLEAN },
    certainty: "high",
    domains: {},
  },
  {
    name: "substantial I² (>=50) -> inconsistency -1 -> moderate",
    input: { ...CLEAN, iSquared: 60 },
    certainty: "moderate",
    domains: { inconsistency: 1 },
  },
  {
    name: "considerable I² (>=75) -> inconsistency -2 -> low",
    input: { ...CLEAN, iSquared: 82 },
    certainty: "low",
    domains: { inconsistency: 2 },
  },
  {
    name: "I² just below threshold (49) -> no downgrade -> high",
    input: { ...CLEAN, iSquared: 49 },
    certainty: "high",
    domains: {},
  },
  {
    name: "CI crosses null -> imprecision -1 -> moderate",
    input: { ...CLEAN, ciLower: 0.8, ciUpper: 1.15, ciCrossesNull: true },
    certainty: "moderate",
    domains: { imprecision: 1 },
  },
  {
    name: "wide ratio CI (upper >= 3x lower) -> imprecision -1 -> moderate",
    input: { ...CLEAN, point: 0.9, ciLower: 0.4, ciUpper: 1.4, ciCrossesNull: true },
    // crosses null AND wide -> imprecision capped at 2 -> low
    certainty: "low",
    domains: { imprecision: 2 },
  },
  {
    name: "small N below OIS (<400) but significant/precise -> imprecision -1 -> moderate",
    input: { ...CLEAN, totalN: 250 },
    certainty: "moderate",
    domains: { imprecision: 1 },
  },
  {
    name: "very small N (<100) alone -> imprecision -1 -> moderate (GRADE: OIS not met = 1 step)",
    input: { ...CLEAN, totalN: 80 },
    certainty: "moderate",
    domains: { imprecision: 1 },
  },
  {
    name: "very small N (<100) co-occurring with null-crossing CI -> imprecision -2 -> low",
    input: { ...CLEAN, totalN: 80, ciLower: 0.8, ciUpper: 1.15, ciCrossesNull: true },
    certainty: "low",
    domains: { imprecision: 2 },
  },
  {
    name: "caller risk-of-bias -1 -> moderate",
    input: { ...CLEAN, riskOfBiasSteps: 1 },
    certainty: "moderate",
    domains: { risk_of_bias: 1 },
  },
  {
    name: "indirectness -1 + publication bias -1 -> low",
    input: { ...CLEAN, indirectnessSteps: 1, publicationBiasSteps: 1 },
    certainty: "low",
    domains: { indirectness: 1, publication_bias: 1 },
  },
  {
    name: "high I² + null-crossing CI -> inconsistency -1 + imprecision -1 -> low",
    input: {
      ...CLEAN,
      iSquared: 60,
      ciLower: 0.75,
      ciUpper: 1.2,
      ciCrossesNull: true,
    },
    certainty: "low",
    domains: { inconsistency: 1, imprecision: 1 },
  },
  {
    name: "multiple serious downgrades floor at very_low",
    input: {
      ...CLEAN,
      iSquared: 82, // inconsistency -2
      ciLower: 0.3,
      ciUpper: 1.3,
      ciCrossesNull: true, // imprecision: null + wide -> -2
      riskOfBiasSteps: 2,
      indirectnessSteps: 2,
      publicationBiasSteps: 1,
    },
    certainty: "very_low",
    domains: {
      inconsistency: 2,
      imprecision: 2,
      risk_of_bias: 2,
      indirectness: 2,
      publication_bias: 1,
    },
  },
];

describe("gradeCertainty — deterministic GRADE downgrade table", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const result = gradeCertainty(c.input);
      expect(result.startingLevel).toBe("high");
      expect(result.certainty).toBe(c.certainty);

      // Every expected domain must be present with the exact step count.
      const byDomain = new Map(result.downgrades.map((d) => [d.domain, d.steps]));
      const expectedDomains = Object.keys(c.domains) as DowngradeDomain[];
      for (const domain of expectedDomains) {
        expect(byDomain.get(domain)).toBe(c.domains[domain]);
      }
      // No unexpected domains were downgraded.
      expect([...byDomain.keys()].sort()).toEqual(expectedDomains.sort());
    });
  }
});

describe("gradeCertainty — structure and purity", () => {
  it("every downgrade carries a domain, a non-empty reason, and 1..2 steps", () => {
    const result = gradeCertainty(CASES[CASES.length - 1].input);
    for (const d of result.downgrades) {
      expect(d.reason.length).toBeGreaterThan(0);
      expect(d.steps).toBeGreaterThanOrEqual(1);
      expect(d.steps).toBeLessThanOrEqual(2);
    }
    expect(result.rationale).toContain("very_low");
  });

  it("does not mutate its input", () => {
    const input: GradeInput = { ...CLEAN, iSquared: 60, riskOfBiasSteps: 1 };
    const snapshot = JSON.stringify(input);
    gradeCertainty(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("clean evidence yields a no-downgrade rationale", () => {
    const result = gradeCertainty({ ...CLEAN });
    expect(result.downgrades).toHaveLength(0);
    expect(result.rationale).toContain("no downgrades");
  });

  it("k<2 disables the inconsistency (heterogeneity) downgrade", () => {
    // A single study has no between-study heterogeneity even if I² is reported.
    const result = gradeCertainty({ ...CLEAN, k: 1, iSquared: 90 });
    const inconsistency = result.downgrades.find((d) => d.domain === "inconsistency");
    expect(inconsistency).toBeUndefined();
  });
});

describe("gradeInputSchema — boundary validation", () => {
  it("rejects I² outside 0..100", () => {
    expect(() =>
      gradeCertainty({ ...CLEAN, iSquared: 120 } as GradeInput)
    ).toThrow();
  });

  it("rejects a CI where upper < lower", () => {
    const bad = { ...CLEAN, ciLower: 1.2, ciUpper: 0.9 } as GradeInput;
    expect(() => gradeCertainty(bad)).toThrow();
  });

  it("rejects judgement steps above 2", () => {
    const parsed = gradeInputSchema.safeParse({ ...CLEAN, riskOfBiasSteps: 3 });
    expect(parsed.success).toBe(false);
  });
});
