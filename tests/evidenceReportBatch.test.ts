import { describe, it, expect } from "vitest";
import {
  buildEvidenceReportBatch,
  evidenceReportBatchToCsv,
  type BatchItem,
} from "../lib/evidenceReportBatch";

// Minimal sanity test: a 2-item batch of one overstatement + one accurate claim,
// pooled over the same three-study fixture used elsewhere (pooled RR ≈ 0.64,
// ~36% reduction; trial reductions 50%/20%/40%). Item A claims a 90% reduction —
// far above the pool and outside 1.5x of every single trial, so it
// "overstates_pooled" (not a single-trial cherry-pick). Item B claims ~36%
// (matches). Verifies order, verdicts, and CSV shape.
const STUDIES: BatchItem["studies"] = [
  { label: "Trial A", measure: "RR", point: 0.5, ci_lower: 0.338, ci_upper: 0.74 },
  { label: "Trial B", measure: "RR", point: 0.8, ci_lower: 0.606, ci_upper: 1.055 },
  { label: "Trial C", measure: "RR", point: 0.6, ci_lower: 0.427, ci_upper: 0.843 },
];

const ITEMS: BatchItem[] = [
  { id: "overstated", claim: "The drug reduced events by 90%.", studies: STUDIES },
  { id: "accurate", claim: "The drug reduced events by about 36%.", studies: STUDIES },
];

describe("buildEvidenceReportBatch — 2-item batch", () => {
  const results = buildEvidenceReportBatch(ITEMS);

  it("returns two rows in input order with no errors", () => {
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("overstated");
    expect(results[1].id).toBe("accurate");
    expect(results[0].error).toBeNull();
    expect(results[1].error).toBeNull();
  });

  it("flags the overstatement and confirms the accurate claim", () => {
    expect(results[0].verdict).toBe("overstates_pooled");
    expect(results[1].verdict).toBe("matches_pooled");
    expect(results[0].pooledPoint).toBeCloseTo(0.64, 1);
  });

  it("CSV has a header row plus two data rows", () => {
    const csv = evidenceReportBatchToCsv(results);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      "id,verdict,certainty,pooledPoint,pooledCiLower,pooledCiUpper,iSquared,publicationBiasFlag,error"
    );
    expect(lines[1].startsWith("overstated,overstates_pooled,")).toBe(true);
    expect(lines[2].startsWith("accurate,matches_pooled,")).toBe(true);
  });
});
