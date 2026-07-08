import { describe, it, expect } from "vitest";
import {
  ExtractedFindingSchema,
  VerificationResultSchema,
  DiscrepancyType,
  CrossSourceAgreement,
} from "../lib/schemas";

describe("ExtractedFindingSchema", () => {
  it("accepts a well-formed finding", () => {
    const result = ExtractedFindingSchema.parse({
      effect_size: "30% relative risk reduction",
      population: "adults 65+ with prior MI",
      condition: "heart failure",
      endpoint: "hospitalization for heart failure at 24 months",
      caveats: ["subgroup analysis only"],
    });
    expect(result.effect_size).toContain("30%");
  });

  it("rejects a finding missing required fields", () => {
    expect(() =>
      ExtractedFindingSchema.parse({ effect_size: "30%" })
    ).toThrow();
  });
});

describe("VerificationResultSchema", () => {
  it("accepts a well-formed accurate verdict with no flagged spans", () => {
    const result = VerificationResultSchema.parse({
      discrepancy_type: "accurate",
      trust_score: 95,
      explanation: "Claim matches source closely.",
      flagged_spans: [],
      cross_source_agreement: "single_source",
    });
    expect(result.trust_score).toBe(95);
    expect(result.cross_source_agreement).toBe("single_source");
  });

  it("rejects a trust_score outside 0-100", () => {
    expect(() =>
      VerificationResultSchema.parse({
        discrepancy_type: "accurate",
        trust_score: 150,
        explanation: "invalid",
        flagged_spans: [],
        cross_source_agreement: "single_source",
      })
    ).toThrow();
  });

  it("rejects an unknown discrepancy_type", () => {
    expect(() =>
      VerificationResultSchema.parse({
        discrepancy_type: "totally_fake",
        trust_score: 50,
        explanation: "invalid",
        flagged_spans: [],
        cross_source_agreement: "single_source",
      })
    ).toThrow();
  });

  it("requires the cross_source_agreement field", () => {
    expect(() =>
      VerificationResultSchema.parse({
        discrepancy_type: "accurate",
        trust_score: 95,
        explanation: "missing cross_source_agreement",
        flagged_spans: [],
      })
    ).toThrow();
  });

  it("rejects an unknown cross_source_agreement value", () => {
    expect(() =>
      VerificationResultSchema.parse({
        discrepancy_type: "accurate",
        trust_score: 95,
        explanation: "invalid agreement",
        flagged_spans: [],
        cross_source_agreement: "mostly_agree",
      })
    ).toThrow();
  });
});

describe("CrossSourceAgreement enum", () => {
  it("covers the three expected categories", () => {
    expect(CrossSourceAgreement.options).toEqual([
      "single_source",
      "corroborated",
      "conflicting",
    ]);
  });
});

describe("DiscrepancyType enum", () => {
  it("covers all five expected categories", () => {
    expect(DiscrepancyType.options).toEqual([
      "accurate",
      "magnitude_overstated",
      "population_overgeneralized",
      "caveat_dropped",
      "no_support_found",
    ]);
  });
});
