import { describe, it, expect, vi, beforeEach } from "vitest";

// Oracle test for smart-citation classification. We stub @/lib/claude so no network
// / API key is needed, and assert the two invariants that make heavy Claude use safe:
//   (1) STANCE — the classified stance from Claude is surfaced to the caller.
//   (2) GROUNDING — a context sentence that is a real substring of the citing text
//       survives with correct offsets and the VERBATIM located text; a fabricated
//       sentence is DROPPED (status "ungroundable"), never asserted.

const callClaudeForJson = vi.fn();

vi.mock("@/lib/claude", () => ({
  callClaudeForJson: (...args: unknown[]) => callClaudeForJson(...args),
  CLAUDE_MODEL: "test-model",
}));

import { classifyCitation, groundCitationClassification } from "@/lib/citations/classify";

const CITING =
  "Amyloid-lowering therapies have shown clinical benefit. In contrast, our cohort found no significant mortality reduction and we were unable to replicate the reported 30% effect.";

beforeEach(() => {
  callClaudeForJson.mockReset();
});

describe("classifyCitation", () => {
  it("surfaces the stance and grounds a verbatim context sentence with correct offsets", async () => {
    const quote =
      "In contrast, our cohort found no significant mortality reduction and we were unable to replicate the reported 30% effect.";
    callClaudeForJson.mockResolvedValueOnce({
      stance: "contrasting",
      context_sentence: quote,
      reasoning: "The passage sets its own null result against the cited 30% effect.",
      confidence: 0.86,
    });

    const outcome = await classifyCitation({
      citing_text: CITING,
      cited_claim: "The intervention reduced all-cause mortality by 30%.",
    });

    expect(outcome.status).toBe("classified");
    if (outcome.status !== "classified") return;
    expect(outcome.classification.stance).toBe("contrasting");
    const { start, end } = outcome.classification.grounding;
    // Offsets point at the real substring, and we return the verbatim located text.
    expect(CITING.slice(start, end)).toBe(outcome.classification.context_sentence);
    expect(outcome.classification.context_sentence).toContain("unable to replicate");
  });

  it("drops a fabricated context sentence as ungroundable rather than asserting it", async () => {
    callClaudeForJson.mockResolvedValueOnce({
      stance: "supporting",
      context_sentence: "This passage strongly endorses the cited 30% mortality benefit.", // not in CITING
      reasoning: "Fabricated — must not be grounded.",
      confidence: 0.9,
    });

    const outcome = await classifyCitation({
      citing_text: CITING,
      cited_claim: "The intervention reduced all-cause mortality by 30%.",
    });

    expect(outcome.status).toBe("ungroundable");
  });
});

describe("groundCitationClassification (pure trust layer)", () => {
  it("recovers verbatim source text even when the model alters whitespace", () => {
    const outcome = groundCitationClassification(CITING, {
      stance: "contrasting",
      // Whitespace-collapsed variant of a real sentence — grounding tier 2 recovers it.
      context_sentence: "In contrast, our cohort found no significant mortality reduction",
      reasoning: "r",
      confidence: 0.5,
    });
    expect(outcome.status).toBe("classified");
    if (outcome.status !== "classified") return;
    const { start, end } = outcome.classification.grounding;
    expect(CITING.slice(start, end)).toBe(outcome.classification.context_sentence);
  });
});
