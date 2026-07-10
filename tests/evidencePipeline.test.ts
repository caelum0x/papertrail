import { describe, it, expect } from "vitest";
import { runEvidencePipeline, type SourceRetriever } from "../lib/evidencePipeline";
import type { SourceCandidate } from "../lib/schemas";

// End-to-end pipeline test with an INJECTED retriever — no live embeddings, no DB, no
// LLM. The mock returns two cached CT.gov sources each carrying a registered PRIMARY
// ratio result, exercising: retrieve → deterministic extract → pool → report + trail.
// A second case returns zero sources and asserts the honest insufficient result.

// A fake pool: never touched, because the retriever is injected.
const fakePool = {} as never;

function ctSource(id: string, hr: number): SourceCandidate {
  return {
    id,
    source_type: "clinicaltrials",
    external_id: `NCT${id}`,
    title: `Trial ${id}`,
    raw_text: "Registered trial with posted primary results.",
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

describe("runEvidencePipeline", () => {
  it("retrieves 2 fixture sources and pools them into a report with a citation trail", async () => {
    const retrieve: SourceRetriever = async () => [
      ctSource("1", 0.75),
      ctSource("2", 0.8),
    ];

    const result = await runEvidencePipeline(
      fakePool,
      { claim: "Drug X reduced major cardiovascular events by about 20%." },
      { retrieve }
    );

    expect(result.usedSources).toHaveLength(2);
    expect(result.usedSources[0]).toMatchObject({ id: "1", source_type: "clinicaltrials" });
    expect(result.skipped).toHaveLength(0);

    expect(result.report.ok).toBe(true);
    if (result.report.ok) {
      expect(result.report.pooled.k).toBe(2);
      expect(result.report.pooled.measure).toBe("HR");
    }
  });

  it("returns an honest insufficient result when retrieval finds no sources", async () => {
    const retrieve: SourceRetriever = async () => [];

    const result = await runEvidencePipeline(
      fakePool,
      { claim: "Some unverifiable off-distribution efficacy claim about a drug." },
      { retrieve }
    );

    expect(result.usedSources).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.report.ok).toBe(false);
    if (!result.report.ok) {
      expect(result.report.usableStudies).toBe(0);
      expect(result.report.reason.length).toBeGreaterThan(0);
    }
  });
});
