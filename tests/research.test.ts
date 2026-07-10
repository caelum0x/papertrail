import { describe, it, expect, vi } from "vitest";
import {
  runResearch,
  type ClaudeJsonCaller,
  type RetrieveSourcesFn,
} from "../lib/research/orchestrator";
import {
  ReportDraftSchema,
  ResearchPlanSchema,
  SourceCompressionSchema,
} from "../lib/research/schemas";
import type { SourceCandidate } from "../lib/schemas";

// Full native deep-research orchestration, OFFLINE: retrieval and Claude are both
// injected, so no live embeddings, DB, or API are touched. Asserts the assimilated
// gpt-researcher + open_deep_research flow — plan -> PARALLEL per-sub-question
// retrieve+compress -> cited report -> grounding — and the grounding invariant:
// a citation whose quote is NOT a substring of the source raw_text is dropped, and
// a claim left with no grounded citation is dropped too.

const SRC_TEXT =
  "In this randomized, placebo-controlled trial, the hazard ratio for the primary " +
  "composite endpoint was 0.75, a statistically significant reduction versus placebo. " +
  "The benefit was consistent across prespecified subgroups.";

function makeSource(id: string, overrides: Partial<SourceCandidate> = {}): SourceCandidate {
  return {
    id,
    source_type: "clinicaltrials",
    external_id: `NCT-${id}`,
    title: `Trial ${id}`,
    raw_text: SRC_TEXT,
    url: `https://clinicaltrials.gov/study/NCT-${id}`,
    similarity: 0.9,
    phase: "Phase 3",
    enrollment_count: 1200,
    registered_results: null,
    ...overrides,
  };
}

const PLAN = {
  interpretation: "Whether the drug reduces the primary composite endpoint and for whom.",
  sub_questions: [
    { question: "Does the drug reduce the primary composite endpoint?", rationale: "Core efficacy." },
    { question: "Is the benefit consistent across major subgroups?", rationale: "Generalisability." },
    { question: "What is the certainty of the pooled evidence?", rationale: "Trust." },
  ],
};

const COMPRESSION_RELEVANT = {
  irrelevant: false,
  evidence: [
    {
      quote: "the hazard ratio for the primary composite endpoint was 0.75",
      point: "Primary endpoint HR was 0.75.",
    },
    {
      quote: "The benefit was consistent across prespecified subgroups",
      point: "Consistent across subgroups.",
    },
  ],
};

const DRAFT = {
  summary: [
    {
      text: "The drug significantly reduced the primary composite endpoint.",
      citations: [
        { source_id: "s1", quote: "a statistically significant reduction versus placebo" },
      ],
    },
    {
      // This claim's only citation is ungroundable -> the whole claim is dropped.
      text: "The drug cured every patient.",
      citations: [{ source_id: "s1", quote: "a quote that does not appear anywhere in the source" }],
    },
  ],
  sections: [
    {
      sub_question: "Does the drug reduce the primary composite endpoint?",
      claims: [
        {
          text: "The hazard ratio was 0.75.",
          citations: [
            { source_id: "s1", quote: "the hazard ratio for the primary composite endpoint was 0.75" },
          ],
        },
      ],
    },
  ],
  limitations: "Based on a small set of cached trials.",
};

/** Claude stub routed by which schema it is asked to satisfy (plan/compress/write). */
function makeClaudeStub(): ClaudeJsonCaller {
  const impl: ClaudeJsonCaller = async ({ schema }) => {
    if ((schema as unknown) === (ResearchPlanSchema as unknown)) {
      return ResearchPlanSchema.parse(PLAN) as never;
    }
    if ((schema as unknown) === (SourceCompressionSchema as unknown)) {
      return SourceCompressionSchema.parse(COMPRESSION_RELEVANT) as never;
    }
    if ((schema as unknown) === (ReportDraftSchema as unknown)) {
      return ReportDraftSchema.parse(DRAFT) as never;
    }
    throw new Error("unexpected schema passed to Claude stub");
  };
  // vi.fn can't preserve the generic call signature of ClaudeJsonCaller, so cast the
  // spy back to the injectable type; the impl above is fully typed as ClaudeJsonCaller.
  return vi.fn(impl) as unknown as ClaudeJsonCaller;
}

describe("runResearch (native deep-research orchestrator)", () => {
  it("plans, fans out one research unit per sub-question, compresses, writes, grounds", async () => {
    const retrieveSources: RetrieveSourcesFn = vi.fn(async (claim: string) => [
      makeSource("s1", { external_id: `NCT-${claim.length}` }),
    ]);
    const callClaudeForJson = makeClaudeStub();

    const result = await runResearch("Does the drug reduce cardiovascular events?", {
      retrieveSources,
      callClaudeForJson,
    });

    // Plan is surfaced verbatim from the planner.
    expect(result.plan.sub_questions).toHaveLength(3);

    // FAN-OUT: retrieval is invoked once per sub-question (parallel executor).
    expect(retrieveSources).toHaveBeenCalledTimes(3);

    // COMPRESS + WRITE both went through Claude with schema validation:
    // 1 plan + (3 sub-questions x 1 source each) compressions + 1 report = 5 calls.
    expect(callClaudeForJson).toHaveBeenCalledTimes(5);

    // Per-sub-question grounded evidence is surfaced for every sub-question.
    expect(result.sub_question_evidence).toHaveLength(3);
    const firstEvidence = result.sub_question_evidence[0];
    expect(firstEvidence.evidence.length).toBeGreaterThan(0);
    // Every surfaced evidence quote is a real substring of the source raw_text.
    for (const ev of firstEvidence.evidence) {
      expect(SRC_TEXT).toContain(ev.quote);
      expect(SRC_TEXT.slice(ev.grounding.start, ev.grounding.end)).toBe(ev.quote);
    }

    // GROUNDING INVARIANT on the report:
    // - the groundable summary claim survives; the ungroundable one is dropped.
    expect(result.report.summary).toHaveLength(1);
    expect(result.report.summary[0].text).toContain("significantly reduced");
    expect(result.report.grounding_dropped_claims).toBe(1);
    expect(result.report.grounding_dropped_citations).toBe(1);

    // Every surviving citation points to a verbatim source substring at its offsets.
    for (const claim of result.report.summary) {
      for (const cite of claim.citations) {
        expect(SRC_TEXT).toContain(cite.quote);
        expect(SRC_TEXT.slice(cite.grounding.start, cite.grounding.end)).toBe(cite.quote);
      }
    }
    expect(result.report.sections[0].claims).toHaveLength(1);
  });

  it("runs sub-question research in parallel (all retrievals start before any resolves)", async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    const retrieveSources: RetrieveSourcesFn = vi.fn(async () => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return [makeSource("s1")];
    });

    await runResearch("Does the drug reduce events across subgroups over time?", {
      retrieveSources,
      callClaudeForJson: makeClaudeStub(),
    });

    // If the executor were sequential, maxConcurrent would be 1. Parallel fan-out
    // (Promise.all over sub-questions) drives all three retrievals concurrently.
    expect(maxConcurrent).toBe(3);
  });

  it("drops an irrelevant source's compression so it never reaches the writer", async () => {
    const retrieveSources: RetrieveSourcesFn = vi.fn(async () => [makeSource("s1")]);
    const callImpl: ClaudeJsonCaller = async ({ schema }) => {
      if ((schema as unknown) === (ResearchPlanSchema as unknown)) {
        return ResearchPlanSchema.parse({
          interpretation: "x",
          sub_questions: [{ question: "Is there any evidence at all?", rationale: "coverage" }],
        }) as never;
      }
      if ((schema as unknown) === (SourceCompressionSchema as unknown)) {
        return SourceCompressionSchema.parse({ irrelevant: true, evidence: [] }) as never;
      }
      return ReportDraftSchema.parse({ summary: [], sections: [], limitations: "none" }) as never;
    };
    const callClaudeForJson = vi.fn(callImpl) as unknown as ClaudeJsonCaller;

    const result = await runResearch("Is there any support for this claim at all?", {
      retrieveSources,
      callClaudeForJson,
    });

    // The irrelevant source contributes no evidence and is not listed as a used source.
    expect(result.sub_question_evidence[0].sources).toHaveLength(0);
    expect(result.sub_question_evidence[0].evidence).toHaveLength(0);
  });

  it("keeps the sub-question alive when one source's compression throws", async () => {
    const retrieveSources: RetrieveSourcesFn = vi.fn(async () => [
      makeSource("s1"),
      makeSource("s2"),
    ]);
    let compressCalls = 0;
    const callImpl: ClaudeJsonCaller = async ({ schema }) => {
      if ((schema as unknown) === (ResearchPlanSchema as unknown)) {
        return ResearchPlanSchema.parse({
          interpretation: "x",
          sub_questions: [{ question: "Does the endpoint improve?", rationale: "efficacy" }],
        }) as never;
      }
      if ((schema as unknown) === (SourceCompressionSchema as unknown)) {
        compressCalls += 1;
        if (compressCalls === 1) throw new Error("compression model overloaded");
        return SourceCompressionSchema.parse(COMPRESSION_RELEVANT) as never;
      }
      return ReportDraftSchema.parse({
        summary: [
          {
            text: "The endpoint improved.",
            citations: [
              { source_id: "s2", quote: "the hazard ratio for the primary composite endpoint was 0.75" },
            ],
          },
        ],
        sections: [],
        limitations: "none",
      }) as never;
    };
    const callClaudeForJson = vi.fn(callImpl) as unknown as ClaudeJsonCaller;

    const result = await runResearch("Does the primary endpoint improve on therapy?", {
      retrieveSources,
      callClaudeForJson,
    });

    // Two sources retrieved, one compression failed -> exactly one used source survives.
    expect(result.sub_question_evidence[0].sources).toHaveLength(1);
    expect(result.sub_question_evidence[0].sources[0].source_id).toBe("s2");
    expect(result.report.summary).toHaveLength(1);
  });
});
