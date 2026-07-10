import { describe, it, expect } from "vitest";
import {
  extractStudyFromSource,
  autoSynthesize,
  type AutoSynthesisSource,
} from "../lib/autoSynthesis";

// Oracle test: deterministic extraction + pooling over in-memory fixture sources, with
// NO DB and NO LLM. One CT.gov row (registered HR + CI), one PubMed row whose raw_text
// carries an HR with a CI, and one no-effect row that must land in `skipped`.

const ctSource: AutoSynthesisSource = {
  id: "11111111-1111-1111-1111-111111111111",
  source_type: "clinicaltrials",
  title: "Trial A (registered)",
  raw_text: "",
  registered_results: [
    {
      outcomeTitle: "Primary composite endpoint",
      outcomeType: "PRIMARY",
      paramType: "Hazard Ratio (HR)",
      paramValue: 0.75,
      ciPct: 95,
      ciLower: 0.65,
      ciUpper: 0.87,
      pValue: "<0.001",
      method: "Cox",
    },
  ],
};

const pubmedSource: AutoSynthesisSource = {
  id: "22222222-2222-2222-2222-222222222222",
  source_type: "pubmed",
  title: "Trial B (abstract)",
  raw_text:
    "In this randomized trial the primary endpoint was reduced (HR 0.80 (95% CI 0.70-0.92)).",
  registered_results: null,
};

const noEffectSource: AutoSynthesisSource = {
  id: "33333333-3333-3333-3333-333333333333",
  source_type: "pubmed",
  title: "Trial C (no parseable effect)",
  raw_text: "The intervention was generally well tolerated with no new safety signals.",
  registered_results: null,
};

describe("extractStudyFromSource", () => {
  it("pulls the registered PRIMARY HR + CI from a CT.gov source", () => {
    const outcome = extractStudyFromSource(ctSource);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.study.measure).toBe("HR");
      expect(outcome.study.point).toBe(0.75);
      expect(outcome.study.ci_lower).toBe(0.65);
      expect(outcome.study.ci_upper).toBe(0.87);
      expect(outcome.study.source_id).toBe(ctSource.id);
    }
  });

  it("parses an HR with CI out of PubMed raw_text", () => {
    const outcome = extractStudyFromSource(pubmedSource);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.study.measure).toBe("HR");
      expect(outcome.study.point).toBe(0.8);
      expect(outcome.study.ci_lower).toBe(0.7);
      expect(outcome.study.ci_upper).toBe(0.92);
    }
  });

  it("captures a skip reason for a source with no usable effect", () => {
    const outcome = extractStudyFromSource(noEffectSource);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("autoSynthesize", () => {
  const result = autoSynthesize({
    claim: "Drug X reduced major cardiovascular events by about 20%.",
    sources: [ctSource, pubmedSource, noEffectSource],
  });

  it("extracts two studies and pools them into a full report", () => {
    expect(result.studies).toHaveLength(2);
    expect(result.report.ok).toBe(true);
    if (result.report.ok) {
      expect(result.report.pooled.k).toBe(2);
      expect(result.report.pooled.measure).toBe("HR");
      // Pooled HR sits between the two inputs (0.75 and 0.80).
      expect(result.report.pooled.random.point).toBeGreaterThan(0.7);
      expect(result.report.pooled.random.point).toBeLessThan(0.85);
    }
  });

  it("captures the no-effect source in skipped", () => {
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].id).toBe(noEffectSource.id);
  });
});
