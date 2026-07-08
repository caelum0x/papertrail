import { describe, it, expect } from "vitest";
import { toBatchMarkdownReport } from "../lib/batchReport";
import { BatchResultItem } from "../components/BatchResults";

const ITEMS: BatchResultItem[] = [
  {
    claim: "Lecanemab slowed cognitive decline by 27%.",
    status: "verified",
    source: {
      title: "Lecanemab in Early Alzheimer's Disease",
      url: "https://pubmed.ncbi.nlm.nih.gov/36449413/",
      source_type: "pubmed",
      external_id: "36449413",
      raw_text: "The difference, -0.45, favored lecanemab.",
    },
    verification: {
      discrepancy_type: "magnitude_overstated",
      trust_score: 35,
      explanation: "The claim overstates what the abstract reports.",
      flagged_spans: [
        {
          claim_span: "27%",
          source_span: "difference, -0.45",
          issue: "Abstract reports an absolute CDR-SB difference, not a 27% figure.",
          grounding: { status: "exact", start: 4, end: 21 },
        },
      ],
    },
    effect_size_check: { verdict: "cannot_reconcile", rationale: "No parseable ratio." },
  },
  {
    claim: "The drug was well tolerated across all age groups.",
    status: "verified",
    source: {
      title: "Safety of Drug X",
      url: "https://pubmed.ncbi.nlm.nih.gov/99999999/",
      source_type: "pubmed",
      external_id: "99999999",
      raw_text: "Adverse events were consistent with prior reports.",
    },
    verification: {
      discrepancy_type: "accurate",
      trust_score: 92,
      explanation: "Consistent with the source.",
      flagged_spans: [],
    },
  },
  {
    claim: "Drug Y cured 100% of patients.",
    status: "no_support_found",
  },
  {
    claim: "Some malformed claim that errored.",
    status: "error",
  },
];

describe("toBatchMarkdownReport", () => {
  it("summarizes total claims and counts by status", () => {
    const md = toBatchMarkdownReport(ITEMS);
    expect(md).toContain("**Claims in this report:** 4");
    expect(md).toContain("2 verified");
    expect(md).toContain("1 no support found");
    expect(md).toContain("1 error");
  });

  it("breaks down verified claims by discrepancy_type", () => {
    const md = toBatchMarkdownReport(ITEMS);
    expect(md).toContain("Magnitude overstated: 1");
    expect(md).toContain("Accurate: 1");
  });

  it("includes a verified claim's verbatim source quote", () => {
    const md = toBatchMarkdownReport(ITEMS);
    expect(md).toContain('Source says: "difference, -0.45"');
    expect(md).toContain("PubMed 36449413");
  });

  it("lists no_support_found claims with an honest note, not a verdict", () => {
    const md = toBatchMarkdownReport(ITEMS);
    expect(md).toContain("Drug Y cured 100% of patients.");
    expect(md).toContain("No confident matching primary source was found");
  });

  it("notes error claims were skipped", () => {
    const md = toBatchMarkdownReport(ITEMS);
    expect(md).toContain("Verification failed for this claim");
  });

  it("is deterministic for the same input", () => {
    expect(toBatchMarkdownReport(ITEMS)).toEqual(toBatchMarkdownReport(ITEMS));
  });
});
