import { describe, it, expect } from "vitest";
import { splitIntoClaims } from "../lib/claimSplitter";

describe("splitIntoClaims", () => {
  it("splits a simple two-sentence passage", () => {
    const out = splitIntoClaims(
      "Lecanemab slowed cognitive decline in early Alzheimer's disease. The benefit was modest."
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toBe("Lecanemab slowed cognitive decline in early Alzheimer's disease.");
    expect(out[1]).toBe("The benefit was modest.");
  });

  it("does NOT split inside decimals or p-values", () => {
    const out = splitIntoClaims(
      "The CDR-SB difference was 0.45 points at 18 months. The result was significant at p<0.001 overall."
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("0.45");
    expect(out[1]).toContain("p<0.001");
  });

  it("does NOT split on abbreviations like e.g., i.e., vs., et al.", () => {
    const out = splitIntoClaims(
      "Several agents (e.g., dapagliflozin) reduced events vs. placebo. The trial by van Dyck et al. enrolled 1795 patients."
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("e.g., dapagliflozin");
    expect(out[0]).toContain("vs. placebo");
    expect(out[1]).toContain("et al.");
    expect(out[1]).toContain("1795 patients");
  });

  it("handles author initials without over-splitting", () => {
    const out = splitIntoClaims(
      "The trial was led by van Dyck C. H. and colleagues. It enrolled 1795 participants."
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("van Dyck C. H.");
  });

  it("drops tiny fragments and whitespace-only pieces", () => {
    const out = splitIntoClaims("Yes. This treatment reduced hospitalization for heart failure by 26%.");
    // "Yes." is below the min claim length and should be dropped.
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("hospitalization for heart failure");
  });

  it("splits multi-sentence paragraphs across newlines", () => {
    const passage = `Intensive blood-pressure control reduced major cardiovascular events.
The hazard ratio was 0.75. Adverse events were more common in the intensive group.`;
    const out = splitIntoClaims(passage);
    expect(out).toHaveLength(3);
    expect(out[1]).toContain("hazard ratio was 0.75");
  });

  it("returns an empty array for empty or whitespace-only input", () => {
    expect(splitIntoClaims("")).toEqual([]);
    expect(splitIntoClaims("   \n  ")).toEqual([]);
  });

  it("preserves the exact claim text so spans can be grounded later", () => {
    const claim = "In SPRINT, the hazard ratio with intensive treatment was 0.75.";
    const out = splitIntoClaims(claim + " A second sentence follows here.");
    expect(out[0]).toBe(claim);
  });
});
