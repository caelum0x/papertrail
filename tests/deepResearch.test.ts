import { describe, it, expect } from "vitest";
import {
  runDeepResearch,
  type ClaudeJsonCaller,
  type SubQuestionResearcher,
} from "../lib/deepResearch/run";
import type { EvidencePipelineResult } from "../lib/evidencePipeline";
import { ResearchPlanSchema, SynthesisReportSchema } from "../lib/deepResearch/schemas";

// Full multi-agent deep-research workflow, OFFLINE: Claude (plan + synthesis) and
// the per-sub-question researcher are both injected, so no live embeddings, DB, or
// API are touched. Asserts the fan-out (plan -> N pipelines -> synthesis) and the
// grounding invariant: a citation whose quote is NOT in the source raw_text is
// dropped, and a claim left with no grounded citation is dropped too.

const fakePool = {} as never;

// A source raw_text the synthesis is allowed to quote verbatim.
const SRC_TEXT =
  "In this randomized trial, the hazard ratio for the primary composite endpoint was 0.75, a statistically significant reduction versus placebo.";

// A structurally-minimal "ok" pooled report. Only the fields the model-facing
// renderer reads must be present; the rest is filled enough to satisfy the type
// via a single `unknown` cast (the workflow never inspects them).
const OK_REPORT = {
  ok: true,
  claim: "",
  pooled: {
    k: 2,
    measure: "HR",
    random: { point: 0.75, ciLower: 0.65, ciUpper: 0.86, reductionPercent: 25, significant: true },
    heterogeneity: { iSquared: 0 },
  },
  certainty: { certainty: "moderate" },
  verdict: {
    verdict: "supported",
    rationale: "Pooled estimate supports the claim.",
    claimedReductionPercent: 25,
    pooledReductionPercent: 25,
    measure: "HR",
  },
  claimedReductionPercent: 25,
  rationale: "Pooled HR 0.75, a 25% reduction; GRADE moderate.",
} as unknown as EvidencePipelineResult["report"];

// Injected researcher: returns one poolable source carrying that raw_text, keyed
// by id, for grounding — exactly the shape the default researcher would capture.
const researchStub: SubQuestionResearcher = async (input) => ({
  result: {
    claim: input.claim,
    usedSources: [{ id: "src-1", title: "Trial A", source_type: "clinicaltrials" }],
    skipped: [],
    report: OK_REPORT,
  },
  rawTextById: new Map([["src-1", SRC_TEXT]]),
});

const PLAN = {
  interpretation: "Whether the drug reduces the primary endpoint.",
  sub_questions: [
    { question: "Does the drug reduce the primary composite endpoint?", rationale: "Core efficacy." },
    { question: "Is the benefit consistent across major subgroups?", rationale: "Generalisability." },
    { question: "What is the certainty of the pooled evidence?", rationale: "Trust." },
  ],
};

describe("runDeepResearch", () => {
  it("plans, fans out one pipeline per sub-question, and grounds the synthesis", async () => {
    // Claude stub: valid plan first, then a synthesis whose summary has one
    // groundable citation (quote IS in SRC_TEXT) and one ungroundable citation.
    const call: ClaudeJsonCaller = async ({ schema }) => {
      if ((schema as unknown) === (ResearchPlanSchema as unknown)) {
        return ResearchPlanSchema.parse(PLAN) as never;
      }
      return SynthesisReportSchema.parse({
        summary: [
          {
            text: "The drug reduced the primary composite endpoint.",
            citations: [
              { source_id: "src-1", quote: "the hazard ratio for the primary composite endpoint was 0.75" },
            ],
          },
          {
            text: "This claim has no locatable source span.",
            citations: [{ source_id: "src-1", quote: "a quote that does not appear anywhere in the source" }],
          },
        ],
        sections: [
          {
            sub_question: "Does the drug reduce the primary composite endpoint?",
            claims: [
              {
                text: "A significant reduction versus placebo was observed.",
                citations: [{ source_id: "src-1", quote: "a statistically significant reduction versus placebo" }],
              },
            ],
          },
        ],
        limitations: "Based on a small pooled set of trials.",
      }) as never;
    };

    const report = await runDeepResearch(fakePool, "Does the drug reduce cardiovascular events?", {
      callClaude: call,
      researchSubQuestion: researchStub,
    });

    // Stage 1: plan decomposed into the 3 sub-questions.
    expect(report.plan.sub_questions).toHaveLength(3);

    // Stage 2: one evidence branch per sub-question, all supported.
    expect(report.evidence).toHaveLength(3);
    expect(report.supported_sub_questions).toBe(3);
    expect(report.sources.map((s) => s.id)).toContain("src-1");

    // Stage 3 grounding: the ungroundable summary citation's claim is dropped,
    // leaving exactly one grounded summary claim; the section claim grounds.
    expect(report.summary).toHaveLength(1);
    expect(report.summary[0].citations[0].source_id).toBe("src-1");
    expect(report.summary[0].citations[0].grounding.status).toBe("exact");
    expect(report.sections[0].claims).toHaveLength(1);
    expect(report.dropped_claims).toBe(1);
    expect(report.limitations.length).toBeGreaterThan(0);
  });

  it("survives a synthesis failure by returning verified evidence with no claims", async () => {
    const call: ClaudeJsonCaller = async ({ schema }) => {
      if ((schema as unknown) === (ResearchPlanSchema as unknown)) {
        return ResearchPlanSchema.parse(PLAN) as never;
      }
      throw new Error("synthesis LLM down");
    };

    const report = await runDeepResearch(fakePool, "A resilient research question?", {
      callClaude: call,
      researchSubQuestion: researchStub,
    });

    expect(report.evidence).toHaveLength(3);
    expect(report.supported_sub_questions).toBe(3);
    expect(report.summary).toHaveLength(0);
    expect(report.sections).toHaveLength(0);
    expect(report.dropped_claims).toBe(0);
  });
});
