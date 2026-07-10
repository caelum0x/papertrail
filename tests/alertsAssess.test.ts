import { describe, it, expect, vi, beforeEach } from "vitest";

// Oracle test for Claude-assessed evidence alerts. We stub @/lib/claude so no network
// / API key is needed, and assert the two invariants that make heavy Claude use safe:
//   (1) IMPACT — Claude's relevance + impact call (confirms/weakens/overturns/none) is
//       surfaced to the caller.
//   (2) GROUNDING — an evidence quote that is a real substring of the source survives
//       with correct offsets and the VERBATIM located text; a fabricated quote is
//       DROPPED (status "ungroundable"), never asserted.

const callClaudeForJson = vi.fn();

vi.mock("@/lib/claude", () => ({
  callClaudeForJson: (...args: unknown[]) => callClaudeForJson(...args),
  CLAUDE_MODEL: "test-model",
}));

import { assessAlert, groundAlertAssessment } from "@/lib/alerts/assess";

const SOURCE =
  "In this large, well-powered phase 3 trial of 9,412 patients, drug X did not significantly reduce major adverse cardiovascular events compared with placebo (HR 1.02, 95% CI 0.91-1.14, p=0.78). The previously reported benefit was not replicated.";

beforeEach(() => {
  callClaudeForJson.mockReset();
});

describe("assessAlert", () => {
  it("surfaces the impact and grounds a verbatim evidence quote with correct offsets", async () => {
    const quote =
      "drug X did not significantly reduce major adverse cardiovascular events compared with placebo (HR 1.02, 95% CI 0.91-1.14, p=0.78)";
    callClaudeForJson.mockResolvedValueOnce({
      relevant: "relevant",
      relevance_reason: "The source reports MACE for drug X versus placebo, the watched topic.",
      likely_impact: "overturns",
      impact_reason: "A large well-powered null against a positive verdict would change the conclusion.",
      evidence_quote: quote,
      confidence: 0.83,
    });

    const outcome = await assessAlert({
      topic: "Does drug X reduce major adverse cardiovascular events versus placebo?",
      currentVerdict: "Pooled evidence suggests drug X reduces MACE by ~25%.",
      sourceText: SOURCE,
    });

    expect(outcome.status).toBe("assessed");
    if (outcome.status !== "assessed") return;
    expect(outcome.assessment.relevant).toBe("relevant");
    expect(outcome.assessment.likely_impact).toBe("overturns");
    const { start, end } = outcome.assessment.grounding;
    // Offsets point at the real substring, and we return the verbatim located text.
    expect(SOURCE.slice(start, end)).toBe(outcome.assessment.evidence_quote);
    expect(outcome.assessment.evidence_quote).toContain("did not significantly reduce");
  });

  it("drops a fabricated evidence quote as ungroundable rather than asserting it", async () => {
    callClaudeForJson.mockResolvedValueOnce({
      relevant: "relevant",
      relevance_reason: "r",
      likely_impact: "confirms",
      impact_reason: "Fabricated — must not be grounded.",
      evidence_quote: "Drug X strongly confirmed the previously reported cardiovascular benefit.", // not in SOURCE
      confidence: 0.9,
    });

    const outcome = await assessAlert({
      topic: "Does drug X reduce major adverse cardiovascular events versus placebo?",
      currentVerdict: null,
      sourceText: SOURCE,
    });

    expect(outcome.status).toBe("ungroundable");
  });
});

describe("groundAlertAssessment (pure trust layer)", () => {
  it("recovers verbatim source text even when the model alters whitespace", () => {
    const outcome = groundAlertAssessment(SOURCE, {
      relevant: "relevant",
      relevance_reason: "r",
      likely_impact: "weakens",
      impact_reason: "r",
      // Whitespace-collapsed variant of a real sentence — grounding tier 2 recovers it.
      evidence_quote: "The previously reported benefit was not replicated.",
      confidence: 0.5,
    });
    expect(outcome.status).toBe("assessed");
    if (outcome.status !== "assessed") return;
    const { start, end } = outcome.assessment.grounding;
    expect(SOURCE.slice(start, end)).toBe(outcome.assessment.evidence_quote);
  });
});
