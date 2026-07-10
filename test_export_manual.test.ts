import { describe, it, expect } from "vitest";
import { buildEvidenceReport } from "./lib/evidenceReport";
import { evidenceReportToHtml, evidenceReportToText } from "./lib/evidenceReportExport";

const STUDIES = [
  { label: "Trial A", measure: "RR" as const, point: 0.5, ci_lower: 0.338, ci_upper: 0.74 },
  { label: "Trial B", measure: "RR" as const, point: 0.8, ci_lower: 0.606, ci_upper: 1.055 },
  { label: "Trial C", measure: "RR" as const, point: 0.6, ci_lower: 0.427, ci_upper: 0.843 },
];

const CLAIM = 'Drug X reduced events by 35% in <trial> "sub-group" & controls.';

describe("evidenceReportExport - Manual Verification", () => {
  it("should compute correct pooled estimates and render them", () => {
    const report = buildEvidenceReport({ claim: CLAIM, studies: STUDIES });
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    // Verify meta-analysis results
    const r = report.pooled.random;
    console.log("Random-effects point:", r.point);
    console.log("CI bounds:", r.ciLower, r.ciUpper);
    console.log("Reduction %:", r.reductionPercent);
    console.log("I²:", report.pooled.heterogeneity.iSquared);
    console.log("k:", report.pooled.k);
    
    // Should match manual calculation: point ~0.638, CI ~[0.485, 0.840]
    expect(r.point).toBeCloseTo(0.638, 2);
    expect(r.ciLower).toBeCloseTo(0.485, 2);
    expect(r.ciUpper).toBeCloseTo(0.840, 2);
    
    // I² should be ~51%
    expect(report.pooled.heterogeneity.iSquared).toBeCloseTo(51.0, 0);

    // HTML output
    const html = evidenceReportToHtml(report, CLAIM);
    
    // Check HTML structure and content
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Summary of Findings");
    expect(html).toContain("GRADE");
    
    // Verify escaping of claim
    expect(html).toContain("&lt;trial&gt;");
    expect(html).toContain("&amp;");
    expect(html).not.toContain("<trial>"); // Should NOT appear unescaped
    
    // Verify pooled numbers appear
    expect(html).toContain("0.64"); // point rounded to 2dp
    expect(html).toContain("0.49"); // ciLower rounded to 2dp
    expect(html).toContain("0.84"); // ciUpper rounded to 2dp
    
    // Verify table structure
    expect(html).toContain("<table class=\"sof\">");
    expect(html).toContain("<thead>");
    expect(html).toContain("Pooled estimate (95% CI)");
    expect(html).toContain("Studies (k)");
    expect(html).toContain("3"); // k value
    
    // Text output
    const text = evidenceReportToText(report, CLAIM);
    expect(text).toContain("SUMMARY OF FINDINGS");
    expect(text).toContain("Pooled estimate");
    expect(text).toContain("0.64"); // Should be rounded consistently
  });

  it("should handle insufficient evidence gracefully", () => {
    const oneStudy = [
      { label: "Trial A", measure: "RR" as const, point: 0.5, ci_lower: 0.338, ci_upper: 0.74 },
    ];
    
    const report = buildEvidenceReport({ claim: CLAIM, studies: oneStudy });
    expect(report.ok).toBe(false);
    if (report.ok) return;
    
    const html = evidenceReportToHtml(report, CLAIM);
    expect(html).toContain("Insufficient evidence");
    expect(html).toContain("could not pool");
    expect(html).not.toContain("<table");
    
    const text = evidenceReportToText(report, CLAIM);
    expect(text).toContain("Insufficient evidence");
  });
});
