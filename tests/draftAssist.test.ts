import { describe, it, expect } from "vitest";
import { runDraftAssist, type DraftPipeline } from "../lib/drafting/assist";
import type { EvidencePipelineResult } from "../lib/evidencePipeline";

// Draft-assistant test with the pipeline AND the drafter INJECTED — no live embeddings,
// no DB, no LLM. It exercises the self-correction trust layer: given a VERIFIED pooled
// number from the engine, an overstated Claude sentence is auto-corrected to the
// engine's value, a consistent one is marked grounded, and a quote that isn't in any
// source is dropped rather than shown as sourced.

const fakePool = {} as never;

// A pipeline result whose engine ground-truth is a ~25% pooled reduction (HR ~0.75).
function pooledPipeline(): DraftPipeline {
  const result: EvidencePipelineResult = {
    claim: "Drug X reduces cardiovascular events.",
    usedSources: [
      { id: "s1", title: "Trial One", source_type: "clinicaltrials" },
      { id: "s2", title: "Trial Two", source_type: "clinicaltrials" },
    ],
    skipped: [],
    report: {
      ok: true,
      claim: "Drug X reduces cardiovascular events.",
      // Only the fields extractEngineTruth reads are needed here.
      pooled: {
        measure: "HR",
        k: 2,
        studies: [],
        fixed: {} as never,
        random: {
          point: 0.75,
          ciLower: 0.66,
          ciUpper: 0.85,
          reductionPercent: 25,
          significant: true,
        } as never,
        heterogeneity: {} as never,
        predictionInterval: null,
        skipped: [],
      } as never,
      publicationBias: { test: null, verdict: "insufficient_studies", note: "" },
      certainty: { certainty: "moderate" } as never,
      verdict: {
        verdict: "matches_pooled",
        rationale: "Consistent.",
        claimedReductionPercent: 25,
        pooledReductionPercent: 25,
        measure: "HR",
      },
      claimedReductionPercent: 25,
      rationale: "Pooled HR 0.75 across 2 trials, about a 25% reduction.",
    },
  };

  return {
    result,
    sources: [
      {
        id: "s1",
        title: "Trial One",
        source_type: "clinicaltrials",
        raw_text:
          "The intervention reduced the primary composite endpoint (hazard ratio 0.75, 95% CI 0.66 to 0.85).",
      },
      {
        id: "s2",
        title: "Trial Two",
        source_type: "clinicaltrials",
        raw_text: "A consistent benefit was observed on the primary outcome.",
      },
    ],
  };
}

describe("runDraftAssist self-correction", () => {
  it("auto-corrects an overstated efficacy sentence to the engine's pooled value and grounds a real quote", async () => {
    const drafter = async () => ({
      sentences: [
        {
          // Overstated: claims 60% vs the engine's 25% pool — must be corrected.
          text: "The drug reduced cardiovascular events by 60%.",
          makesEfficacyClaim: true,
          statedReductionPercent: 60,
          supportingQuote: null,
        },
        {
          // Consistent with the ~25% pool — grounded, not corrected.
          text: "The treatment lowered risk by about 25%.",
          makesEfficacyClaim: true,
          statedReductionPercent: 25,
          // Verbatim quote present in s1's raw_text — should ground.
          supportingQuote: "hazard ratio 0.75, 95% CI 0.66 to 0.85",
        },
        {
          // Non-numeric framing with a quote that is NOT in any source — dropped.
          text: "These findings support further study.",
          makesEfficacyClaim: false,
          statedReductionPercent: null,
          supportingQuote: "a quote that appears in none of the sources",
        },
      ],
    });

    const out = await runDraftAssist(
      fakePool,
      { topic: "Drug X reduces cardiovascular events in adults.", section: "results" },
      { runPipeline: async () => pooledPipeline(), draft: drafter }
    );

    expect(out.section).toBe("results");
    expect(out.evidence.sufficient).toBe(true);
    expect(out.evidence.pooledReductionPercent).toBe(25);

    // Sentence 1: overstated -> corrected to the engine's 25%, and flagged.
    const first = out.sentences[0];
    expect(first.corrected).toBeDefined();
    expect(first.corrected?.engineReductionPercent).toBe(25);
    expect(first.text).toContain("25%");
    expect(first.text).not.toContain("60%");
    expect(first.grounded).toBe(true);

    // Sentence 2: consistent + real quote grounded.
    const second = out.sentences[1];
    expect(second.corrected).toBeUndefined();
    expect(second.grounded).toBe(true);
    expect(second.quote?.quote).toBe("hazard ratio 0.75, 95% CI 0.66 to 0.85");
    expect(second.quote?.source_id).toBe("s1");

    // Sentence 3: ungroundable quote dropped -> no quote, marked unverified.
    const third = out.sentences[2];
    expect(third.quote).toBeUndefined();
    expect(third.grounded).toBe(false);

    expect(out.summary.corrected).toBe(1);
    expect(out.summary.efficacyClaims).toBe(2);
  });

  it("hedges a numeric sentence when the engine reports insufficient evidence", async () => {
    const insufficient: DraftPipeline = {
      result: {
        claim: "Rare-disease drug efficacy claim.",
        usedSources: [],
        skipped: [],
        report: {
          ok: false,
          claim: "Rare-disease drug efficacy claim.",
          reason: "Fewer than two poolable trials were found.",
          claimedReductionPercent: null,
          usableStudies: 0,
          skipped: [],
        },
      },
      sources: [],
    };

    const drafter = async () => ({
      sentences: [
        {
          text: "The therapy cut events by 40%.",
          makesEfficacyClaim: true,
          statedReductionPercent: 40,
          supportingQuote: null,
        },
      ],
    });

    const out = await runDraftAssist(
      fakePool,
      { topic: "Some rare-disease drug efficacy claim to draft." },
      { runPipeline: async () => insufficient, draft: drafter }
    );

    expect(out.evidence.sufficient).toBe(false);
    // The specific magnitude must be removed / hedged — no unverifiable number asserted.
    expect(out.sentences[0].text).not.toContain("40%");
    expect(out.sentences[0].corrected).toBeDefined();
  });
});
