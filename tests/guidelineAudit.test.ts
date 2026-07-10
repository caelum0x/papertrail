import { describe, it, expect } from "vitest";
import { auditGuideline } from "../lib/guidelineAudit/audit";
import type { ClaimVerifier } from "../lib/guidelineAudit/audit";
import type { ExtractedClaim } from "../lib/guidelineAudit/schemas";
import type { EvidencePipelineResult } from "../lib/evidencePipeline";
import type { MetaAnalysisResult } from "../lib/metaAnalysis";

// Offline audit test — BOTH heavy steps injected: Claude extraction and the
// deterministic verify pipeline. No live model, embeddings, or DB. Exercises:
//   - each extracted claim grounded to an exact sentence in the pasted document
//   - the evidence report → verdict/trust-score mapping (accurate vs overstated vs
//     unsupported), and the summary counts
//   - the invariant that an ungroundable source sentence drops the claim.

const fakePool = {} as never;

// A minimal pooled result the report mapper reads. Only the fields the audit touches
// need to be real; the rest satisfy the type.
function pooled(point: number): MetaAnalysisResult {
  return {
    measure: "HR",
    k: 2,
    fixed: { point, ciLower: point - 0.1, ciUpper: point + 0.1, significant: true },
    random: { point, ciLower: point - 0.1, ciUpper: point + 0.1, significant: true },
    heterogeneity: { q: 0, df: 1, pValue: 0.9, iSquared: 0, tauSquared: 0 },
    studies: [],
  } as unknown as MetaAnalysisResult;
}

function okReport(verdict: string): EvidencePipelineResult["report"] {
  return {
    ok: true,
    claim: "x",
    pooled: pooled(0.7),
    publicationBias: { test: null, verdict: "insufficient_studies", note: "" },
    certainty: {
      certainty: "high",
      startingLevel: "high",
      downgrades: [],
      rationale: "",
    },
    verdict: {
      verdict: verdict as never,
      rationale: `verdict is ${verdict}`,
      claimedReductionPercent: 40,
      pooledReductionPercent: 30,
      measure: "HR",
    },
    claimedReductionPercent: 40,
    rationale: "",
  } as EvidencePipelineResult["report"];
}

function result(report: EvidencePipelineResult["report"]): EvidencePipelineResult {
  return { claim: "x", usedSources: [], skipped: [], report };
}

// The document Claude "reads". The extract mock returns sentences that appear verbatim
// here so they can be grounded; one deliberately does not, to test the drop.
const DOCUMENT = [
  "DrugX cut major cardiovascular events by 40% versus placebo.",
  "It improved overall survival across all subgroups.",
].join(" ");

describe("auditGuideline", () => {
  it("extracts, grounds, verifies each claim and summarises verdicts", async () => {
    const extract = async (): Promise<ExtractedClaim[]> => [
      {
        statement: "DrugX reduced major cardiovascular events by 40%.",
        sourceSentence: "DrugX cut major cardiovascular events by 40% versus placebo.",
        intervention: "DrugX",
      },
      {
        statement: "DrugX improved overall survival across all subgroups.",
        sourceSentence: "It improved overall survival across all subgroups.",
        intervention: "DrugX",
      },
    ];

    // First claim overstates the pool; second matches it.
    const verdicts = ["overstates_pooled", "matches_pooled"];
    let call = 0;
    const verify: ClaimVerifier = async () => result(okReport(verdicts[call++]));

    const audit = await auditGuideline(fakePool, DOCUMENT, { extract, verify });

    expect(audit.claims).toHaveLength(2);

    const overstated = audit.claims[0];
    expect(overstated.verdict).toBe("overstated");
    expect(overstated.trustScore).toBeLessThanOrEqual(35);
    // Grounded to an EXACT span of the pasted document.
    expect(overstated.groundedSpan.status).toBe("exact");
    expect(DOCUMENT.slice(overstated.groundedSpan.start, overstated.groundedSpan.end)).toBe(
      overstated.groundedSpan.text
    );
    expect(overstated.pooledFinding?.measure).toBe("HR");

    expect(audit.claims[1].verdict).toBe("accurate");

    expect(audit.summary).toEqual({
      total: 2,
      accurate: 1,
      overstated: 1,
      unsupported: 0,
    });
  });

  it("marks a claim unsupported when no primary source is found", async () => {
    const extract = async (): Promise<ExtractedClaim[]> => [
      {
        statement: "DrugX improved overall survival across all subgroups.",
        sourceSentence: "It improved overall survival across all subgroups.",
        intervention: "DrugX",
      },
    ];
    const verify: ClaimVerifier = async () =>
      result({
        ok: false,
        claim: "x",
        reason: "No confident matching primary source was retrieved.",
        claimedReductionPercent: null,
        usableStudies: 0,
        skipped: [],
      });

    const audit = await auditGuideline(fakePool, DOCUMENT, { extract, verify });
    expect(audit.claims).toHaveLength(1);
    expect(audit.claims[0].verdict).toBe("unsupported");
    expect(audit.claims[0].trustScore).toBe(0);
    expect(audit.claims[0].pooledFinding).toBeNull();
    expect(audit.summary.unsupported).toBe(1);
  });

  it("drops a claim whose source sentence can't be grounded in the document", async () => {
    const extract = async (): Promise<ExtractedClaim[]> => [
      {
        statement: "A claim whose source sentence is nowhere in the document.",
        sourceSentence: "This sentence does not appear in the pasted text at all.",
        intervention: "DrugX",
      },
    ];
    const verify: ClaimVerifier = async () => result(okReport("matches_pooled"));

    const audit = await auditGuideline(fakePool, DOCUMENT, { extract, verify });
    expect(audit.claims).toHaveLength(0);
    expect(audit.summary.total).toBe(0);
  });
});
