import { describe, it, expect } from "vitest";
import { buildEvidenceReport } from "../lib/evidenceReport";
import { evidenceReportToPdf } from "../lib/export/pdf";

// The PDF exporter is deterministic and needs no API/DB: buildEvidenceReport with a
// single study returns the insufficient-evidence shape, which the exporter must still
// render as a valid PDF.
describe("evidenceReportToPdf", () => {
  it("renders a valid PDF for an insufficient-evidence report", async () => {
    const report = buildEvidenceReport({
      claim: "The drug cut cardiovascular risk in half.",
      studies: [{ label: "Trial A", measure: "HR", point: 0.75, ci_lower: 0.64, ci_upper: 0.89 }],
    });
    expect(report.ok).toBe(false);

    const bytes = await evidenceReportToPdf(report, "The drug cut cardiovascular risk in half.");
    expect(bytes.length).toBeGreaterThan(500);
    // PDF magic header %PDF-
    const header = String.fromCharCode(...bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
  });

  it("renders a valid PDF for a pooled multi-study report", async () => {
    const report = buildEvidenceReport({
      claim: "Across trials the drug reduced events by about 20%.",
      studies: [
        { label: "A", measure: "HR", point: 0.75, ci_lower: 0.64, ci_upper: 0.89 },
        { label: "B", measure: "HR", point: 0.82, ci_lower: 0.7, ci_upper: 0.96 },
        { label: "C", measure: "HR", point: 0.84, ci_lower: 0.72, ci_upper: 0.98 },
      ],
    });
    expect(report.ok).toBe(true);
    const bytes = await evidenceReportToPdf(report, "Across trials the drug reduced events by about 20%.");
    const header = String.fromCharCode(...bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
