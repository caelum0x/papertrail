import { describe, it, expect } from "vitest";

// These tests exercise the real extraction agent against the live Claude API
// and are skipped unless ANTHROPIC_API_KEY is set (e.g. in CI without secrets,
// or in a sandbox with no network access to api.anthropic.com). Run locally
// with a real .env.local to validate against tests/fixtures/test-claims.json.
const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);

describe.skipIf(!hasApiKey)("extractFinding (live API)", () => {
  it("extracts a structured finding from a sample abstract", async () => {
    const { extractFinding } = await import("../lib/agents/extractionAgent");
    const sampleText =
      "In a randomized, double-blind trial of 4,500 adults aged 65 and older " +
      "with heart failure and reduced ejection fraction, treatment reduced " +
      "hospitalization for heart failure by 26% over 18 months. Results were " +
      "not significant in the subgroup with preserved ejection fraction.";
    const finding = await extractFinding(`test-${Date.now()}`, sampleText);
    expect(finding.population.toLowerCase()).toContain("65");
    expect(finding.caveats.length).toBeGreaterThan(0);
  }, 30000);
});
