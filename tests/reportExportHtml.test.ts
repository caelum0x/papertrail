import { describe, it, expect } from "vitest";
import { toHtmlReport, escapeHtml } from "../lib/reportExportHtml";
import { ReportInput } from "../lib/reportExport";

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

describe("toHtmlReport", () => {
  it("renders a complete self-contained HTML document", () => {
    const html = toHtmlReport(BASE);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
    expect(html).toContain("<style>");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<script");
  });

  it("includes the verdict label, trust score, claim, and PMID citation", () => {
    const html = toHtmlReport(BASE);
    expect(html).toContain("Magnitude overstated");
    expect(html).toContain("35/100");
    expect(html).toContain("Lecanemab slowed cognitive decline by 27%.");
    expect(html).toContain("PubMed 36449413");
    expect(html).toContain("https://pubmed.ncbi.nlm.nih.gov/36449413/");
  });

  it("renders each flagged span with its verbatim source quote and issue", () => {
    const html = toHtmlReport(BASE);
    expect(html).toContain("difference, -0.45");
    expect(html).toContain("Abstract reports an absolute CDR-SB difference");
  });

  it("omits the numeric check when it deferred (cannot_reconcile)", () => {
    const html = toHtmlReport(BASE);
    expect(html).not.toContain("Numeric check");
  });

  it("shows the numeric check when it fired", () => {
    const html = toHtmlReport({
      ...BASE,
      effectSizeCheck: { verdict: "consistent", rationale: "Claim ~25% matches HR 0.75." },
    });
    expect(html).toContain("Numeric check");
    expect(html).toContain("Claim ~25% matches HR 0.75.");
  });

  it("escapes HTML/script-injection attempts in dynamic text", () => {
    const injected = "<script>alert('xss')</script>";
    const html = toHtmlReport({
      ...BASE,
      claim: injected,
      verification: { ...BASE.verification, explanation: injected },
    });
    // The injected claim/explanation must not appear as raw markup...
    expect(html).not.toContain("<script>alert('xss')</script>");
    // ...but the escaped form must be present.
    expect(html).toContain("&lt;script&gt;");
    // The only <script literal in the document is none — the doc ships no scripts.
    expect(html.includes("<script")).toBe(false);
  });

  it("escapeHtml escapes all five significant characters", () => {
    expect(escapeHtml("<a href=\"x\">'&'</a>")).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;"
    );
  });
});
