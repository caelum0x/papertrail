import { describe, it, expect } from "vitest";
import { toMarkdownReport, ReportInput } from "../lib/reportExport";

const BASE: ReportInput = {
  claim: "Lecanemab slowed cognitive decline by 27%.",
  source: {
    title: "Lecanemab in Early Alzheimer's Disease",
    url: "https://pubmed.ncbi.nlm.nih.gov/36449413/",
    source_type: "pubmed",
    external_id: "36449413",
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
        grounding: { status: "exact", start: 10, end: 27 },
      },
    ],
  },
  effectSizeCheck: { verdict: "cannot_reconcile", rationale: "No parseable ratio." },
};

describe("toMarkdownReport", () => {
  it("includes the verdict, trust score, claim, and source citation with PMID", () => {
    const md = toMarkdownReport(BASE);
    expect(md).toContain("Magnitude overstated");
    expect(md).toContain("35/100");
    expect(md).toContain("Lecanemab slowed cognitive decline by 27%.");
    expect(md).toContain("PubMed 36449413");
    expect(md).toContain("https://pubmed.ncbi.nlm.nih.gov/36449413/");
  });

  it("renders each flagged span with its verbatim source quote", () => {
    const md = toMarkdownReport(BASE);
    expect(md).toContain('Source says: "difference, -0.45"');
    expect(md).toContain("Abstract reports an absolute CDR-SB difference");
  });

  it("omits the numeric check when it deferred (cannot_reconcile)", () => {
    const md = toMarkdownReport(BASE);
    expect(md).not.toContain("Numeric check");
  });

  it("shows the numeric check when it fired", () => {
    const md = toMarkdownReport({
      ...BASE,
      effectSizeCheck: { verdict: "consistent", rationale: "Claim ~25% matches HR 0.75." },
    });
    expect(md).toContain("Numeric check");
    expect(md).toContain("Claim ~25% matches HR 0.75.");
  });

  it("states no discrepancies for an accurate verdict", () => {
    const md = toMarkdownReport({
      ...BASE,
      verification: {
        discrepancy_type: "accurate",
        trust_score: 95,
        explanation: "Consistent with the source.",
        flagged_spans: [],
      },
      effectSizeCheck: undefined,
    });
    expect(md).toContain("No discrepancies flagged");
    expect(md).toContain("95/100");
  });
});
