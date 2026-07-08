import { describe, it, expect } from "vitest";

const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);

describe.skipIf(!hasApiKey)("verifyClaim (live API)", () => {
  it("flags an overstated magnitude claim", async () => {
    const { verifyClaim } = await import("../lib/agents/verificationAgent");
    const result = await verifyClaim({
      claim: "This drug cuts cardiovascular risk in half.",
      finding: {
        effect_size: "18% relative risk reduction",
        population: "adults with type 2 diabetes and established cardiovascular disease",
        condition: "cardiovascular disease",
        endpoint: "major adverse cardiovascular events at 3 years",
        caveats: ["benefit not significant in primary prevention subgroup"],
      },
      sourceRawText:
        "Treatment reduced major adverse cardiovascular events by 18% (HR 0.82) " +
        "over 3 years in adults with type 2 diabetes and established cardiovascular " +
        "disease. The effect was not statistically significant in the primary " +
        "prevention subgroup.",
    });
    expect(result.discrepancy_type).toBe("magnitude_overstated");
    expect(result.trust_score).toBeLessThan(60);
  }, 30000);

  it("classifies two agreeing sources as corroborated", async () => {
    const { verifyClaim } = await import("../lib/agents/verificationAgent");
    const result = await verifyClaim({
      claim:
        "An SGLT2 inhibitor reduced hospitalization for heart failure in patients with reduced ejection fraction.",
      finding: {
        effect_size: "26% relative reduction in heart-failure hospitalization",
        population: "adults with heart failure and reduced ejection fraction",
        condition: "heart failure with reduced ejection fraction",
        endpoint: "hospitalization for heart failure",
        caveats: [],
      },
      sourceRawText:
        "In a randomized trial, the SGLT2 inhibitor reduced hospitalization for heart " +
        "failure by 26% in adults with heart failure and reduced ejection fraction.",
      otherFindings: [
        {
          effect_size: "30% relative reduction in heart-failure hospitalization",
          population: "adults with reduced ejection fraction heart failure",
          condition: "heart failure with reduced ejection fraction",
          endpoint: "hospitalization for heart failure",
          caveats: [],
        },
      ],
    });
    expect(result.cross_source_agreement).toBe("corroborated");
  }, 30000);
});
