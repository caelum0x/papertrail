import { describe, it, expect } from "vitest";
import { createEvidenceReportSchema } from "../lib/evidenceReports/schemas";

// Minimal sanity check for the persistence boundary schema. This layer validates
// the shape of a stored report; it does NOT recompute the science.
describe("createEvidenceReportSchema", () => {
  it("accepts a claim + an object report with optional summary fields", () => {
    const parsed = createEvidenceReportSchema.parse({
      claim: "Drug X reduced events by 30%",
      report: { ok: true, verdict: { verdict: "supported" } },
      verdict: "supported",
      certainty: "moderate",
      pooled: { random: { point: 0.7 } },
    });
    expect(parsed.claim).toContain("30%");
    expect(parsed.report).toBeTypeOf("object");
  });

  it("rejects a non-object report (array or primitive)", () => {
    expect(() =>
      createEvidenceReportSchema.parse({ claim: "valid claim", report: [1, 2, 3] })
    ).toThrow();
    expect(() =>
      createEvidenceReportSchema.parse({ claim: "valid claim", report: "not an object" })
    ).toThrow();
  });

  it("rejects an empty claim", () => {
    expect(() =>
      createEvidenceReportSchema.parse({ claim: "", report: {} })
    ).toThrow();
  });
});
