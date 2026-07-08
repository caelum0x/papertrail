import { describe, it, expect } from "vitest";
import { DEMO_EXAMPLES } from "../lib/demoExamples";
import demoClaims from "./fixtures/demo-claims.json";

interface FixtureClaim {
  id: string;
  claim: string;
}

const fixtureById = new Map<string, FixtureClaim>(
  (demoClaims as FixtureClaim[]).map((c) => [c.id, c]),
);

describe("DEMO_EXAMPLES", () => {
  it("has exactly three examples", () => {
    expect(DEMO_EXAMPLES).toHaveLength(3);
  });

  it("uses ids that exist in the demo-claims fixture", () => {
    for (const example of DEMO_EXAMPLES) {
      expect(fixtureById.has(example.id)).toBe(true);
    }
  });

  it("pins the ids in the intended landing-page order", () => {
    expect(DEMO_EXAMPLES.map((e) => e.id)).toEqual([
      "demo-hero-catch-lecanemab",
      "demo-green-pass-sprint",
      "demo-honest-abstention-sprint-mismatch",
    ]);
  });

  it("copies each claim verbatim from the matching fixture entry", () => {
    for (const example of DEMO_EXAMPLES) {
      const fixture = fixtureById.get(example.id);
      expect(fixture).toBeDefined();
      expect(example.claim.length).toBeGreaterThan(0);
      expect(example.claim).toBe(fixture!.claim);
    }
  });

  it("gives every example a non-empty label and blurb", () => {
    for (const example of DEMO_EXAMPLES) {
      expect(example.label.length).toBeGreaterThan(0);
      expect(example.blurb.length).toBeGreaterThan(0);
    }
  });
});
