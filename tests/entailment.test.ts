import { describe, it, expect, vi } from "vitest";
import {
  checkEntailment,
  type EntailmentDeps,
  type EntailmentJudgement,
} from "@/lib/grounding/entailment";

// Native port of MiniCheck (EMNLP 2024): sentence-level claim-vs-document
// entailment. Claude makes the consistency judgement (the trained-model step);
// lib/grounding then grounds the supporting sentence back into the document. The
// critical invariant under test is the GROUNDING-DOWNGRADE: a model that claims
// "supported" but quotes a sentence not present in the document has fabricated
// its support, and must be downgraded to unsupported.
//
// Claude is injected via deps, so these tests never touch the network or need a
// key. The injected fn still runs the REAL Zod schema.parse (as callClaudeForJson
// does), so malformed model output would fail here too.

const DOCUMENT =
  "In a randomized, double-blind trial, Drug X reduced major adverse cardiovascular " +
  "events by 30% over 24 months compared with placebo. The benefit was confined to " +
  "patients aged 65 and older.";

/** Build injectable deps whose Claude returns a fixed judgement, running real Zod. */
function depsReturning(judgement: EntailmentJudgement): {
  deps: EntailmentDeps;
  calls: ReturnType<typeof vi.fn>;
} {
  const calls = vi.fn(
    (params: { schema: { parse: (v: unknown) => unknown }; system: string; user: string }) => {
      // Exercise validation exactly like the real callClaudeForJson does.
      return Promise.resolve(params.schema.parse(judgement) as EntailmentJudgement);
    }
  );
  return { deps: { callClaudeForJson: calls as unknown as EntailmentDeps["callClaudeForJson"] }, calls };
}

describe("checkEntailment (MiniCheck native port)", () => {
  it("returns supported with a grounded span when the support sentence is verbatim in the document", async () => {
    const supportSentence =
      "In a randomized, double-blind trial, Drug X reduced major adverse cardiovascular events by 30% over 24 months compared with placebo.";
    const { deps, calls } = depsReturning({
      supported: true,
      confidence: 0.94,
      supporting_sentence: supportSentence,
    });

    const result = await checkEntailment(
      { claim: "Drug X reduced cardiovascular events by 30%.", document: DOCUMENT },
      deps
    );

    expect(result.supported).toBe(true);
    expect(result.score).toBe(0.94);
    expect(result.supportingSpan).not.toBeNull();
    // The grounded span is the verbatim document text, with valid offsets.
    expect(result.supportingSpan?.text).toBe(supportSentence);
    expect(result.supportingSpan?.grounding.status).toBe("exact");
    expect(
      DOCUMENT.slice(
        result.supportingSpan!.grounding.start,
        result.supportingSpan!.grounding.end
      )
    ).toBe(supportSentence);
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("DOWNGRADES to unsupported when the model fabricates a supporting sentence not in the document", async () => {
    const { deps } = depsReturning({
      supported: true, // model claims support...
      confidence: 0.9,
      // ...but this sentence appears nowhere in DOCUMENT — fabricated support.
      supporting_sentence:
        "Drug X eliminated all cardiovascular events and cured the underlying disease.",
    });

    const result = await checkEntailment(
      { claim: "Drug X cures cardiovascular disease.", document: DOCUMENT },
      deps
    );

    // Grounding-downgrade invariant: fabricated support -> unsupported, score 0.
    expect(result.supported).toBe(false);
    expect(result.score).toBe(0);
    expect(result.supportingSpan).toBeNull();
  });

  it("returns unsupported honestly (preserving confidence) when the model judges inconsistent", async () => {
    const { deps } = depsReturning({
      supported: false,
      confidence: 0.12,
      supporting_sentence: "",
    });

    const result = await checkEntailment(
      { claim: "Drug X works equally in all age groups.", document: DOCUMENT },
      deps
    );

    expect(result.supported).toBe(false);
    expect(result.score).toBe(0.12);
    expect(result.supportingSpan).toBeNull();
  });

  it("grounds a whitespace-normalized supporting sentence to the verbatim document span", async () => {
    // Model collapses the internal whitespace of a real document sentence. Tier-2
    // grounding still recovers the exact original substring.
    const { deps } = depsReturning({
      supported: true,
      confidence: 0.8,
      supporting_sentence: "The benefit was confined to patients aged 65 and older.",
    });

    const result = await checkEntailment(
      { claim: "The benefit was limited to older patients.", document: DOCUMENT },
      deps
    );

    expect(result.supported).toBe(true);
    expect(result.supportingSpan?.text).toBe(
      "The benefit was confined to patients aged 65 and older."
    );
  });

  it("rejects empty claim or document at the boundary", async () => {
    const { deps } = depsReturning({ supported: false, confidence: 0, supporting_sentence: "" });

    await expect(checkEntailment({ claim: "  ", document: DOCUMENT }, deps)).rejects.toThrow(
      /claim must be non-empty/
    );
    await expect(checkEntailment({ claim: "x", document: "   " }, deps)).rejects.toThrow(
      /document must be non-empty/
    );
  });
});
