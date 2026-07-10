import { describe, it, expect } from "vitest";
import {
  classifyPathogenicity,
  starRatingForReviewStatus,
  normalizeSignificance,
  lookupVariant,
  verifyPathogenicityClaim,
  type FetchLike,
} from "../lib/bio/variantPathogenicity";
import type { ClinVarVariantRecord } from "../lib/bio/variant.schemas";

// Deterministic pathogenicity verification over MOCKED ClinVar esummary responses —
// no network. Locks the documented ClinVar review-status → gold-star scale and the
// claim-vs-record verdict logic (confirmed / overstated_certainty / conflicting /
// not_found). Data source: NCBI ClinVar (public domain).

// --- Helpers: build a fetch stub that returns a fixed esearch + esummary payload ---

// A fetch stub keyed by URL substring: the first call (esearch) returns the id list,
// the second (esummary) returns the result object. Offline, deterministic.
function mockFetch(idlist: string[], esummaryResult: Record<string, unknown>): FetchLike {
  return async (url: string) => {
    if (url.includes("esearch")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ esearchresult: { idlist } }),
      };
    }
    // esummary
    return {
      ok: true,
      status: 200,
      json: async () => ({
        result: { uids: idlist, ...esummaryResult },
      }),
    };
  };
}

// Build a single esummary record in the germline_classification shape.
function summaryRecord(opts: {
  title: string;
  significance: string;
  reviewStatus: string;
  condition: string;
}): Record<string, unknown> {
  return {
    title: opts.title,
    germline_classification: {
      description: opts.significance,
      review_status: opts.reviewStatus,
      trait_set: [{ trait_name: opts.condition }],
    },
  };
}

function record(partial: Partial<ClinVarVariantRecord>): ClinVarVariantRecord {
  return {
    variant: "NM_000546.6(TP53):c.743G>A",
    clinicalSignificance: "Pathogenic",
    rawSignificance: "Pathogenic",
    condition: "Li-Fraumeni syndrome",
    reviewStatus: "reviewed by expert panel",
    starRating: 3,
    ...partial,
  };
}

// --- Star mapping (documented field-standard scale) --------------------------------

describe("starRatingForReviewStatus — documented ClinVar scale", () => {
  it("practice guideline → 4★", () => {
    expect(starRatingForReviewStatus("practice guideline")).toBe(4);
  });
  it("reviewed by expert panel → 3★", () => {
    expect(starRatingForReviewStatus("reviewed by expert panel")).toBe(3);
  });
  it("criteria provided, multiple submitters, no conflicts → 2★", () => {
    expect(
      starRatingForReviewStatus("criteria provided, multiple submitters, no conflicts")
    ).toBe(2);
  });
  it("criteria provided, single submitter → 1★", () => {
    expect(starRatingForReviewStatus("criteria provided, single submitter")).toBe(1);
  });
  it("no assertion criteria provided → 0★", () => {
    expect(starRatingForReviewStatus("no assertion criteria provided")).toBe(0);
  });
  it("case-insensitive", () => {
    expect(starRatingForReviewStatus("PRACTICE GUIDELINE")).toBe(4);
  });
  it("unknown / null status → honest 0★ floor (never a guess)", () => {
    expect(starRatingForReviewStatus("something unrecognized")).toBe(0);
    expect(starRatingForReviewStatus(null)).toBe(0);
  });
});

describe("normalizeSignificance — ACMG tier mapping", () => {
  it("distinguishes Likely pathogenic from Pathogenic", () => {
    expect(normalizeSignificance("Likely pathogenic")).toBe("Likely pathogenic");
    expect(normalizeSignificance("Pathogenic")).toBe("Pathogenic");
  });
  it("maps uncertain significance → VUS", () => {
    expect(normalizeSignificance("Uncertain significance")).toBe("VUS");
  });
  it("maps conflicting classifications → Conflicting", () => {
    expect(
      normalizeSignificance("Conflicting classifications of pathogenicity")
    ).toBe("Conflicting");
  });
  it("unmappable string → null (honest unknown)", () => {
    expect(normalizeSignificance("drug response")).toBeNull();
    expect(normalizeSignificance(null)).toBeNull();
  });
});

// --- The overstated-certainty catch: claimed Pathogenic vs a 1-star VUS ------------

describe("classifyPathogenicity — deterministic verdict", () => {
  it("claimed Pathogenic but ClinVar is a 1★ VUS → overstated_certainty", () => {
    const r = classifyPathogenicity({
      rsId: "rs121912651",
      hgvs: null,
      gene: "TP53",
      condition: null,
      claimedSignificance: "Pathogenic",
      records: [
        record({
          clinicalSignificance: "VUS",
          rawSignificance: "Uncertain significance",
          reviewStatus: "criteria provided, single submitter",
          starRating: 1,
        }),
      ],
    });
    expect(r.verdict).toBe("overstated_certainty");
    expect(r.bestRecord?.starRating).toBe(1);
    expect(r.bestRecord?.clinicalSignificance).toBe("VUS");
  });

  it("claimed Pathogenic and ClinVar is a 3★ Pathogenic record → confirmed", () => {
    const r = classifyPathogenicity({
      rsId: "rs121912651",
      hgvs: null,
      gene: "TP53",
      condition: null,
      claimedSignificance: "Pathogenic",
      records: [record({})],
    });
    expect(r.verdict).toBe("confirmed");
    expect(r.bestRecord?.starRating).toBe(3);
  });

  it("claimed Pathogenic but ClinVar is Pathogenic at only 0★ → overstated_certainty", () => {
    const r = classifyPathogenicity({
      rsId: null,
      hgvs: null,
      gene: "BRCA1",
      condition: null,
      claimedSignificance: "Pathogenic",
      records: [
        record({
          clinicalSignificance: "Pathogenic",
          rawSignificance: "Pathogenic",
          reviewStatus: "no assertion criteria provided",
          starRating: 0,
        }),
      ],
    });
    // Pathogenic label, but 0★ (no assertion criteria) is below the confident floor.
    expect(r.verdict).toBe("overstated_certainty");
  });

  it("ClinVar reports conflicting classifications → conflicting", () => {
    const r = classifyPathogenicity({
      rsId: "rs80357382",
      hgvs: null,
      gene: "BRCA1",
      condition: null,
      claimedSignificance: "Pathogenic",
      records: [
        record({
          clinicalSignificance: "Conflicting",
          rawSignificance: "Conflicting classifications of pathogenicity",
          reviewStatus: "criteria provided, conflicting classifications",
          starRating: 1,
        }),
      ],
    });
    expect(r.verdict).toBe("conflicting");
  });

  it("no records → not_found (honest empty)", () => {
    const r = classifyPathogenicity({
      rsId: "rs999999999",
      hgvs: null,
      gene: null,
      condition: null,
      claimedSignificance: "Pathogenic",
      records: [],
    });
    expect(r.verdict).toBe("not_found");
    expect(r.bestRecord).toBeNull();
  });

  it("a condition filter that excludes all records → not_found", () => {
    const r = classifyPathogenicity({
      rsId: "rs121912651",
      hgvs: null,
      gene: "TP53",
      condition: "cystic fibrosis",
      claimedSignificance: "Pathogenic",
      records: [record({ condition: "Li-Fraumeni syndrome" })],
    });
    expect(r.verdict).toBe("not_found");
  });

  it("selects the HIGHEST-star record among several as bestRecord", () => {
    const r = classifyPathogenicity({
      rsId: "rs121912651",
      hgvs: null,
      gene: "TP53",
      condition: null,
      claimedSignificance: "Pathogenic",
      records: [
        record({ starRating: 1, reviewStatus: "criteria provided, single submitter" }),
        record({ starRating: 3, reviewStatus: "reviewed by expert panel" }),
        record({ starRating: 0, reviewStatus: "no assertion criteria provided" }),
      ],
    });
    expect(r.verdict).toBe("confirmed");
    expect(r.bestRecord?.starRating).toBe(3);
  });
});

// --- End-to-end over a mocked esearch/esummary round-trip --------------------------

describe("lookupVariant + verifyPathogenicityClaim — mocked ClinVar round-trip", () => {
  it("normalizes an esummary record (star + tier) through the fetcher", async () => {
    const deps = {
      fetch: mockFetch(["12345"], {
        "12345": summaryRecord({
          title: "NM_000546.6(TP53):c.743G>A (p.Arg248Gln)",
          significance: "Pathogenic",
          reviewStatus: "reviewed by expert panel",
          condition: "Li-Fraumeni syndrome",
        }),
      }),
    };
    const records = await lookupVariant({ rsId: "rs121912651" }, deps);
    expect(records).toHaveLength(1);
    expect(records[0].clinicalSignificance).toBe("Pathogenic");
    expect(records[0].starRating).toBe(3);
  });

  it("catches an overstated claim end-to-end (claimed Pathogenic vs 1★ VUS)", async () => {
    const deps = {
      fetch: mockFetch(["67890"], {
        "67890": summaryRecord({
          title: "NM_000059.4(BRCA2):c.9976A>T",
          significance: "Uncertain significance",
          reviewStatus: "criteria provided, single submitter",
          condition: "Hereditary breast ovarian cancer syndrome",
        }),
      }),
    };
    const result = await verifyPathogenicityClaim(
      { rsId: "rs169547", claimedSignificance: "Pathogenic" },
      deps
    );
    expect(result.verdict).toBe("overstated_certainty");
    expect(result.bestRecord?.starRating).toBe(1);
  });

  it("returns honest not_found when ClinVar has no hits", async () => {
    const deps = { fetch: mockFetch([], {}) };
    const result = await verifyPathogenicityClaim(
      { rsId: "rs000000", claimedSignificance: "Pathogenic" },
      deps
    );
    expect(result.verdict).toBe("not_found");
    expect(result.records).toHaveLength(0);
  });

  it("returns honest not_found when the upstream fetch fails (never a guess)", async () => {
    const deps: { fetch: FetchLike } = {
      fetch: async () => {
        throw new Error("network down");
      },
    };
    const result = await verifyPathogenicityClaim(
      { rsId: "rs121912651", claimedSignificance: "Pathogenic" },
      deps
    );
    expect(result.verdict).toBe("not_found");
  });
});
