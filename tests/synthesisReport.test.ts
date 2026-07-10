import { describe, it, expect } from "vitest";
import {
  generateSynthesisReport,
  type ReportRetriever,
  type DraftCaller,
} from "../lib/synthesisReport/generate";
import type { SynthesisDraft } from "../lib/synthesisReport/schemas";
import type { SourceCandidate } from "../lib/schemas";

// Full generator flow with an INJECTED retriever and an INJECTED (mock) Claude drafter —
// no live embeddings, DB, or API. Two CT.gov sources with registered PRIMARY hazard
// ratios pool into a real GRADE-rated report; the mock draft mixes a groundable factual
// sentence (quote present in a source), an UNgroundable one (quote absent), and a
// connective one — asserting the engine keeps grounded prose and drops unsourced claims.

const fakePool = {} as never;

function ctSource(id: string, hr: number, text: string): SourceCandidate {
  return {
    id,
    source_type: "clinicaltrials",
    external_id: `NCT${id}`,
    title: `Trial ${id}`,
    raw_text: text,
    url: `https://clinicaltrials.gov/study/NCT${id}`,
    similarity: 0.9,
    phase: "PHASE3",
    enrollment_count: 1000,
    registered_results: [
      {
        outcomeTitle: "Primary composite endpoint",
        outcomeType: "PRIMARY",
        paramType: "Hazard Ratio (HR)",
        paramValue: hr,
        ciPct: 95,
        ciLower: hr - 0.1,
        ciUpper: hr + 0.1,
        pValue: "<0.001",
        method: "Cox",
      },
    ],
  };
}

const GROUNDABLE_QUOTE = "hospitalization for heart failure was reduced";

const retrieve: ReportRetriever = async () => [
  ctSource("1", 0.75, `In trial 1, ${GROUNDABLE_QUOTE} versus placebo.`),
  ctSource("2", 0.8, "In trial 2, the primary endpoint favored treatment."),
];

const mockDraft: SynthesisDraft = {
  title: "SGLT2 inhibitors and heart-failure hospitalization: a synthesis",
  sections: [
    {
      id: "background",
      heading: "Background",
      sentences: [
        { text: "Heart failure is a major cause of hospitalization.", citations: [], source_quote: null },
      ],
    },
    {
      id: "findings",
      heading: "Findings",
      sentences: [
        {
          text: "Across the pooled trials the effect favored treatment.",
          citations: ["1"],
          source_quote: GROUNDABLE_QUOTE,
        },
        {
          text: "One trial reported a 99% cure rate that appears nowhere in the sources.",
          citations: ["2"],
          source_quote: "a 99% cure rate that appears nowhere",
        },
      ],
    },
  ],
};

const draft: DraftCaller = async () => mockDraft;

describe("generateSynthesisReport", () => {
  it("pools sources, keeps grounded prose, and drops ungroundable factual sentences", async () => {
    const report = await generateSynthesisReport(
      fakePool,
      { topic: "SGLT2 inhibitors reduce heart-failure hospitalization in type 2 diabetes." },
      { retrieve, draft }
    );

    // Engine supplied the numbers.
    expect(report.grounded).toBe(true);
    expect(report.facts.poolable).toBe(true);
    expect(report.facts.k).toBe(2);
    expect(report.facts.measure).toBe("HR");
    expect(report.facts.certainty).not.toBeNull();
    expect(report.usedSources).toHaveLength(2);

    // Canonical five sections always present.
    expect(report.sections.map((s) => s.id)).toEqual([
      "background",
      "methods",
      "findings",
      "certainty",
      "limitations",
    ]);

    const findings = report.sections.find((s) => s.id === "findings");
    expect(findings).toBeDefined();

    // The groundable factual sentence is kept, with a real grounding ref.
    const grounded = findings?.sentences.find((s) => s.grounding !== null);
    expect(grounded).toBeDefined();
    expect(grounded?.grounding?.source_id).toBe("1");
    expect(grounded?.grounding?.source_span).toContain("hospitalization for heart failure");

    // The ungroundable factual sentence was dropped, not kept.
    expect(report.droppedSentenceCount).toBe(1);
    const hasFabricated = report.sections.some((s) =>
      s.sentences.some((sent) => sent.text.includes("99% cure rate"))
    );
    expect(hasFabricated).toBe(false);

    // The connective background sentence is kept with no grounding/citations.
    const background = report.sections.find((s) => s.id === "background");
    expect(background?.sentences[0]?.grounding).toBeNull();
    expect(background?.sentences[0]?.citations).toEqual([]);
  });
});
