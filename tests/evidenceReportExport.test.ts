import { describe, it, expect } from "vitest";
import { buildEvidenceReport } from "../lib/evidenceReport";
import {
  evidenceReportToHtml,
  evidenceReportToText,
} from "../lib/evidenceReportExport";

// Minimal serializer sanity test: the SoF export must surface the GRADE certainty,
// the pooled CI, and an ESCAPED claim in the HTML, and the synthesis verdict in the
// plain-text variant. Same three-study RR fixture the engines' oracles use.
const STUDIES = [
  { label: "Trial A", measure: "RR" as const, point: 0.5, ci_lower: 0.338, ci_upper: 0.74 },
  { label: "Trial B", measure: "RR" as const, point: 0.8, ci_lower: 0.606, ci_upper: 1.055 },
  { label: "Trial C", measure: "RR" as const, point: 0.6, ci_lower: 0.427, ci_upper: 0.843 },
];

// Claim carries markup-significant characters to prove the escaper runs.
const CLAIM = 'Drug X reduced events by 35% in <trial> "sub-group" & controls.';

describe("evidenceReportExport", () => {
  const report = buildEvidenceReport({ claim: CLAIM, studies: STUDIES });

  it("renders HTML containing the certainty, the pooled CI, and an escaped claim", () => {
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    const html = evidenceReportToHtml(report, CLAIM);

    // Certainty (label form) appears in the badge.
    const certLabel = { high: "High", moderate: "Moderate", low: "Low", very_low: "Very low" }[
      report.certainty.certainty
    ];
    expect(html).toContain(certLabel);
    expect(html).toContain("certainty");

    // The pooled random-effects CI bounds are rendered (2dp).
    const r = report.pooled.random;
    const lo = (Math.round(r.ciLower * 100) / 100).toString();
    const hi = (Math.round(r.ciUpper * 100) / 100).toString();
    expect(html).toContain(lo);
    expect(html).toContain(hi);

    // Claim is HTML-escaped — raw angle brackets / quotes must not leak through.
    expect(html).toContain("&lt;trial&gt;");
    expect(html).toContain("&amp;");
    expect(html).not.toContain("<trial>");
  });

  it("renders a text variant containing the synthesis verdict", () => {
    if (!report.ok) return;
    const text = evidenceReportToText(report, CLAIM);
    expect(text).toContain("SYNTHESIS VERDICT");
    expect(text).toContain("Pooled estimate");
  });
});
