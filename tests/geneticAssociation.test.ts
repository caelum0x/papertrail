import { describe, it, expect } from "vitest";
import { classifyGeneticAssociation } from "../lib/bio/geneticAssociation";
import type { GwasAssociation, ClinVarRecord } from "../lib/bio/genetics.schemas";

// Deterministic verdict logic over (mocked) GWAS Catalog + ClinVar records — no
// network. Locks the field-standard significance thresholds: genome-wide at
// p ≤ 5e-8, suggestive at 5e-8 < p ≤ 1e-5.
const DISEASE = "type 2 diabetes";

function gwas(pValue: number): GwasAssociation {
  return { rsId: "rs7903146", gene: "TCF7L2", trait: DISEASE, pValue, orBeta: 1.4, riskAllele: "T", study: "GWAS X" };
}
function clinvar(sig: string): ClinVarRecord {
  return { variant: "rs7903146", clinicalSignificance: sig, condition: DISEASE, reviewStatus: "reviewed by expert panel" };
}

describe("classifyGeneticAssociation — deterministic verdict", () => {
  it("p ≤ 5e-8 → genome_wide_significant", () => {
    const r = classifyGeneticAssociation({ disease: DISEASE, gene: "TCF7L2", variant: null, gwas: [gwas(3e-9)], clinvar: [] });
    expect(r.verdict).toBe("genome_wide_significant");
    expect(r.minPValue).toBeCloseTo(3e-9, 12);
  });

  it("5e-8 < p ≤ 1e-5 → suggestive", () => {
    const r = classifyGeneticAssociation({ disease: DISEASE, gene: "TCF7L2", variant: null, gwas: [gwas(1e-6)], clinvar: [] });
    expect(r.verdict).toBe("suggestive");
  });

  it("no records → no_association_found (honest empty)", () => {
    const r = classifyGeneticAssociation({ disease: DISEASE, gene: "TCF7L2", variant: null, gwas: [], clinvar: [] });
    expect(r.verdict).toBe("no_association_found");
    expect(r.minPValue).toBeNull();
  });

  it("ClinVar Pathogenic (no significant GWAS) → clinvar_pathogenic", () => {
    const r = classifyGeneticAssociation({
      disease: DISEASE,
      gene: "TCF7L2",
      variant: "rs7903146",
      gwas: [],
      clinvar: [clinvar("Pathogenic")],
    });
    expect(r.verdict).toBe("clinvar_pathogenic");
  });

  it("carries the supporting records + standard thresholds on every verdict", () => {
    const r = classifyGeneticAssociation({ disease: DISEASE, gene: "TCF7L2", variant: null, gwas: [gwas(3e-9)], clinvar: [] });
    expect(r.thresholds.genomeWideSignificant).toBe(5e-8);
    expect(r.thresholds.suggestive).toBe(1e-5);
    expect(r.supporting.gwas).toHaveLength(1);
  });
});
