import { describe, it, expect } from "vitest";
import { buildEvidenceCertainty } from "../lib/verify/evidenceCertainty";
import type { TrialResultAnalysis } from "../lib/sources/clinicaltrials";

// Oracle sanity test: two clinicaltrials sources, each with a registered PRIMARY
// hazard-ratio primary result showing a consistent, precise ~25% reduction, should
// pool into a significant effect and rate "high" GRADE certainty (no inconsistency,
// no imprecision, no declared judgement downgrades). A pubmed source and a source
// with no poolable ratio are correctly ignored.

function hrAnalysis(point: number, lo: number, hi: number): TrialResultAnalysis {
  return {
    outcomeTitle: "Primary composite endpoint",
    outcomeType: "PRIMARY",
    paramType: "Hazard Ratio (HR)",
    paramValue: point,
    ciPct: 95,
    ciLower: lo,
    ciUpper: hi,
    pValue: "0.001",
    method: "Cox",
  };
}

describe("buildEvidenceCertainty", () => {
  it("pools two consistent registered HR primaries and rates high certainty", () => {
    const result = buildEvidenceCertainty([
      { source_type: "clinicaltrials", title: "TRIAL-A", registered_results: [hrAnalysis(0.75, 0.65, 0.86)] },
      { source_type: "clinicaltrials", title: "TRIAL-B", registered_results: [hrAnalysis(0.76, 0.66, 0.88)] },
      { source_type: "pubmed", title: "Review", registered_results: null },
    ]);
    expect(result).not.toBeNull();
    expect(result!.pooledSourceCount).toBe(2);
    expect(result!.pooled.measure).toBe("HR");
    expect(result!.pooled.point).toBeLessThan(1);
    expect(result!.pooled.significant).toBe(true);
    expect(result!.certainty).toBe("high");
    expect(result!.contributingSources).toEqual(["TRIAL-A", "TRIAL-B"]);
  });

  it("returns null when fewer than two sources are poolable", () => {
    expect(
      buildEvidenceCertainty([
        { source_type: "clinicaltrials", title: "TRIAL-A", registered_results: [hrAnalysis(0.75, 0.65, 0.86)] },
        { source_type: "pubmed", title: "Review", registered_results: null },
      ])
    ).toBeNull();
  });
});
