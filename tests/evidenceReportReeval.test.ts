import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EvidenceReportRecord } from "@/lib/evidenceReports/types";
import type { EvidencePipelineResult } from "@/lib/evidencePipeline";
import type { BuildEvidenceReportResult } from "@/lib/evidenceReport";

// Mock the org-scoped loader (the only DB boundary). The pipeline runner is injected
// per-call via opts.runPipeline, so no live retrieval / embeddings / DB is touched.
const getReport = vi.fn();
vi.mock("@/lib/evidenceReports/repository", () => ({
  getReport: (...args: unknown[]) => getReport(...args),
}));

import { reevaluateReport } from "@/lib/evidenceReports/reeval";

const pool = {} as never;

// A stored report whose saved conclusion is "supported / moderate" over 3 studies.
function storedRecord(): EvidenceReportRecord {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    orgId: "org-1",
    projectId: null,
    createdBy: "user-1",
    claim: "Drug X reduced major events by 30% versus placebo.",
    verdict: "supported",
    certainty: "moderate",
    pooled: { k: 3 },
    report: { pooled: { k: 3 } },
    createdAt: new Date().toISOString(),
  };
}

// Build a fresh pipeline result carrying a poolable (ok:true) report with the given
// verdict / GRADE certainty / study count — the deterministic engine output the diff
// compares against the stored summary.
function freshResult(
  verdict: string,
  certainty: string,
  k: number
): EvidencePipelineResult {
  const report = {
    ok: true,
    claim: "c",
    pooled: { k },
    certainty: { certainty },
    verdict: { verdict },
    claimedReductionPercent: 30,
    publicationBias: {},
    rationale: "",
  } as unknown as BuildEvidenceReportResult;
  return { claim: "c", usedSources: [], skipped: [], report };
}

describe("reevaluateReport", () => {
  beforeEach(() => {
    getReport.mockReset();
  });

  it("flags changed:true with the right delta when the fresh verdict/certainty/k differ", async () => {
    getReport.mockResolvedValue(storedRecord());
    // New trials ingested: verdict flips, certainty drops, and one more study pools.
    const runPipeline = vi.fn().mockResolvedValue(
      freshResult("contradicted", "low", 4)
    );

    const result = await reevaluateReport(
      pool,
      { orgId: "org-1", reportId: "11111111-1111-1111-1111-111111111111" },
      { runPipeline }
    );

    expect(result).not.toBeNull();
    expect(result!.changed).toBe(true);
    expect(result!.previous).toEqual({
      verdict: "supported",
      certainty: "moderate",
      k: 3,
    });
    expect(result!.current).toEqual({
      verdict: "contradicted",
      certainty: "low",
      k: 4,
    });
    expect(result!.delta).toEqual({
      verdictChanged: true,
      certaintyChanged: true,
      kDelta: 1,
    });
    // The pipeline was re-run for the SAVED claim, org-scoped via getReport.
    expect(runPipeline).toHaveBeenCalledWith(
      pool,
      { claim: "Drug X reduced major events by 30% versus placebo." },
      undefined
    );
  });

  it("reports changed:false when the fresh conclusion matches the stored one", async () => {
    getReport.mockResolvedValue(storedRecord());
    const runPipeline = vi
      .fn()
      .mockResolvedValue(freshResult("supported", "moderate", 3));

    const result = await reevaluateReport(
      pool,
      { orgId: "org-1", reportId: "11111111-1111-1111-1111-111111111111" },
      { runPipeline }
    );

    expect(result).not.toBeNull();
    expect(result!.changed).toBe(false);
    expect(result!.delta).toEqual({
      verdictChanged: false,
      certaintyChanged: false,
      kDelta: 0,
    });
  });

  it("returns null when the report is missing or in another tenant", async () => {
    getReport.mockResolvedValue(null);
    const runPipeline = vi.fn();

    const result = await reevaluateReport(
      pool,
      { orgId: "org-1", reportId: "11111111-1111-1111-1111-111111111111" },
      { runPipeline }
    );

    expect(result).toBeNull();
    expect(runPipeline).not.toHaveBeenCalled();
  });
});
