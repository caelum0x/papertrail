import { describe, it, expect, vi, beforeEach } from "vitest";

// Oracle tests for SciEval — the native MultiVerS + SciFact port. We stub @/lib/claude
// (no API key / network) and @/lib/agents/retrievalAgent (no DB), then assert the
// invariants that make the label+rationale flow trustworthy:
//   (1) LABEL + RATIONALE — Claude's SUPPORTS/REFUTES label is surfaced and its selected
//       rationale sentences are grounded to VERBATIM abstract text with correct offsets.
//   (2) FABRICATED RATIONALE DROPPED => NEI — a rationale sentence that is not a real
//       substring of the abstract is dropped; if that leaves a non-NEI label with no
//       grounded rationale, the label is downgraded to NEI (MultiVerS never asserts a
//       label with no supporting abstract sentence).
//   (3) NEI passthrough carries no rationales.
//   (4) Retrieval fallback: no abstract + no confident source => honest "no_source_found".

const callClaudeForJson = vi.fn();
const retrieveSources = vi.fn();

vi.mock("@/lib/claude", () => ({
  callClaudeForJson: (...args: unknown[]) => callClaudeForJson(...args),
  CLAUDE_MODEL: "test-model",
}));

vi.mock("@/lib/agents/retrievalAgent", () => ({
  retrieveSources: (...args: unknown[]) => retrieveSources(...args),
}));

import { verifyClaim, groundVerification, splitAbstract } from "@/lib/scieval/verify";

const ABSTRACT =
  "This randomized trial enrolled 4200 adults with prior myocardial infarction. Drug X reduced major adverse cardiovascular events by 30% compared with placebo over 24 months. The benefit was confined to patients older than 65. No significant reduction was seen in all-cause mortality.";

const CLAIM = "Drug X reduced cardiovascular events by 30%.";

beforeEach(() => {
  callClaudeForJson.mockReset();
  retrieveSources.mockReset();
});

describe("splitAbstract (deterministic segmentation)", () => {
  it("segments an abstract into sentences without splitting decimals or abbreviations", () => {
    const sents = splitAbstract(
      "Mean age was 65.4 years (e.g. older adults). Events fell by 0.30. See Fig. 2 for details."
    );
    expect(sents).toEqual([
      "Mean age was 65.4 years (e.g. older adults).",
      "Events fell by 0.30.",
      "See Fig. 2 for details.",
    ]);
  });
});

describe("verifyClaim label + rationale flow", () => {
  it("surfaces the SUPPORTS label and grounds a rationale sentence to verbatim abstract text", async () => {
    const rationale =
      "Drug X reduced major adverse cardiovascular events by 30% compared with placebo over 24 months.";
    callClaudeForJson.mockResolvedValueOnce({
      label: "SUPPORTS",
      rationale_sentences: [rationale],
      reasoning: "The abstract reports the same 30% reduction the claim asserts.",
    });

    const outcome = await verifyClaim({ claim: CLAIM, abstract: ABSTRACT });

    expect(outcome.status).toBe("verified");
    if (outcome.status !== "verified") return;
    expect(outcome.verification.label).toBe("SUPPORTS");
    expect(outcome.verification.downgraded_to_nei).toBe(false);
    expect(outcome.verification.rationales).toHaveLength(1);

    const { start, end } = outcome.verification.rationales[0].grounding;
    // Offsets point at the real substring, and we return the VERBATIM located text.
    expect(ABSTRACT.slice(start, end)).toBe(outcome.verification.rationales[0].sentence);
    expect(outcome.verification.rationales[0].sentence).toContain("reduced major adverse");
  });

  it("drops a fabricated rationale sentence and downgrades a non-NEI label to NEI", async () => {
    callClaudeForJson.mockResolvedValueOnce({
      label: "SUPPORTS",
      // Not a substring of ABSTRACT — must be dropped, leaving no grounded rationale.
      rationale_sentences: ["Drug X eliminated all cardiovascular deaths in every subgroup."],
      reasoning: "Fabricated rationale — must not be asserted.",
    });

    const outcome = await verifyClaim({ claim: CLAIM, abstract: ABSTRACT });

    expect(outcome.status).toBe("verified");
    if (outcome.status !== "verified") return;
    expect(outcome.verification.label).toBe("NEI");
    expect(outcome.verification.rationales).toHaveLength(0);
    expect(outcome.verification.dropped_rationale_count).toBe(1);
    expect(outcome.verification.downgraded_to_nei).toBe(true);
  });

  it("passes an NEI label through with no rationales", async () => {
    callClaudeForJson.mockResolvedValueOnce({
      label: "NEI",
      rationale_sentences: [],
      reasoning: "The abstract does not address this claim.",
    });

    const outcome = await verifyClaim({
      claim: "Drug X cures diabetes.",
      abstract: ABSTRACT,
    });

    expect(outcome.status).toBe("verified");
    if (outcome.status !== "verified") return;
    expect(outcome.verification.label).toBe("NEI");
    expect(outcome.verification.rationales).toHaveLength(0);
    expect(outcome.verification.downgraded_to_nei).toBe(false);
  });
});

describe("verifyClaim retrieval fallback", () => {
  it("returns no_source_found when no abstract is supplied and retrieval is empty", async () => {
    retrieveSources.mockResolvedValueOnce([]);

    const outcome = await verifyClaim({ claim: CLAIM });

    expect(outcome.status).toBe("no_source_found");
    // Claude must not be invoked when there is nothing to verify against.
    expect(callClaudeForJson).not.toHaveBeenCalled();
  });

  it("verifies against a retrieved source and attaches its citation trail", async () => {
    retrieveSources.mockResolvedValueOnce([
      {
        id: "src-1",
        source_type: "pubmed",
        external_id: "12345678",
        title: "Drug X CV outcomes trial",
        raw_text: ABSTRACT,
        url: "https://pubmed.ncbi.nlm.nih.gov/12345678/",
        similarity: 0.91,
      },
    ]);
    callClaudeForJson.mockResolvedValueOnce({
      label: "REFUTES",
      rationale_sentences: ["No significant reduction was seen in all-cause mortality."],
      reasoning: "The abstract contradicts a mortality-benefit claim.",
    });

    const outcome = await verifyClaim({ claim: "Drug X reduced all-cause mortality." });

    expect(outcome.status).toBe("verified");
    if (outcome.status !== "verified") return;
    expect(outcome.verification.label).toBe("REFUTES");
    expect(outcome.source?.external_id).toBe("12345678");
    expect(outcome.source?.similarity).toBe(0.91);
  });
});

describe("groundVerification (pure trust layer)", () => {
  it("recovers verbatim abstract text even when the model alters whitespace", () => {
    const v = groundVerification(ABSTRACT, {
      label: "SUPPORTS",
      // Whitespace-collapsed variant of a real sentence — grounding tier 2 recovers it.
      rationale_sentences: [
        "Drug X reduced major   adverse cardiovascular events by 30% compared with placebo over 24 months.",
      ],
      reasoning: "r",
    });
    expect(v.label).toBe("SUPPORTS");
    const { start, end } = v.rationales[0].grounding;
    expect(ABSTRACT.slice(start, end)).toBe(v.rationales[0].sentence);
  });

  it("dedupes repeated rationale selections", () => {
    const sentence = "The benefit was confined to patients older than 65.";
    const v = groundVerification(ABSTRACT, {
      label: "SUPPORTS",
      rationale_sentences: [sentence, sentence],
      reasoning: "r",
    });
    expect(v.rationales).toHaveLength(1);
  });
});
