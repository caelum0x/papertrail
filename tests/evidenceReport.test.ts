import { describe, it, expect } from "vitest";
import { buildEvidenceReport } from "../lib/evidenceReport";

// Minimal orchestration sanity test: the composite report must chain the four
// engines into one consistent object whose pooled numbers match the standalone
// meta-analysis oracle, and must degrade gracefully below two studies.
//
// Same three-study RR fixture the metaAnalysis oracle uses (fixed RR ≈ 0.657).
const STUDIES = [
  { label: "Trial A", measure: "RR" as const, point: 0.5, ci_lower: 0.338, ci_upper: 0.74 },
  { label: "Trial B", measure: "RR" as const, point: 0.8, ci_lower: 0.606, ci_upper: 1.055 },
  { label: "Trial C", measure: "RR" as const, point: 0.6, ci_lower: 0.427, ci_upper: 0.843 },
];

describe("buildEvidenceReport — orchestration", () => {
  const report = buildEvidenceReport({
    claim: "Drug X reduced major events by about 35% across trials.",
    studies: STUDIES,
  });

  it("pools all three studies and matches the meta-analysis oracle", () => {
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.pooled.k).toBe(3);
    expect(report.pooled.fixed.point).toBeCloseTo(0.657, 2);
  });

  it("runs Egger's test and yields a GRADE certainty level", () => {
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    // k=3 is the minimum for Egger's test, so it must have run (not "insufficient").
    expect(report.publicationBias.verdict).not.toBe("insufficient_studies");
    expect(["high", "moderate", "low", "very_low"]).toContain(report.certainty.certainty);
    expect(typeof report.verdict.verdict).toBe("string");
  });

  it("omits absoluteEffects without a baseline, adds them with one", () => {
    // Strictly additive: no baselineRisk => field absent.
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.absoluteEffects).toBeUndefined();

    // With a baseline in (0,1), the pooled random RR is translated to absolute
    // effects. RR<1 pooled => benefit => positive ARR at the given baseline.
    const withBase = buildEvidenceReport({
      claim: "Drug X reduced major events by about 35% across trials.",
      studies: STUDIES,
      baselineRisk: 0.2,
    });
    expect(withBase.ok).toBe(true);
    if (!withBase.ok) return;
    expect(withBase.absoluteEffects).toBeDefined();
    expect(withBase.absoluteEffects?.direction).toBe("benefit");
    expect(withBase.absoluteEffects?.absoluteRiskReduction).toBeGreaterThan(0);
    // riskControl echoes the supplied baseline.
    expect(withBase.absoluteEffects?.riskControl).toBeCloseTo(0.2, 4);
  });

  it("returns an honest insufficient report below two studies", () => {
    const one = buildEvidenceReport({
      claim: "Drug X reduced major events by about 35%.",
      studies: [STUDIES[0]],
    });
    expect(one.ok).toBe(false);
    if (one.ok) return;
    expect(one.usableStudies).toBe(1);
  });
});
