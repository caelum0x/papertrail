import { describe, it, expect, vi } from "vitest";
import {
  buildEvidenceDossier,
  computeOverallScore,
  gradeDossier,
  DOSSIER_SECTIONS_BY_SUBJECT,
  type DossierDeps,
  type ClinicalTrialsResult,
} from "../lib/dossier/build";
import {
  EvidenceDossierSchema,
  type DossierPlan,
  type DossierNarrative,
  type SectionName,
} from "../lib/dossier/schemas";
import type { GeneticAssociationResult } from "../lib/bio/genetics.schemas";
import type { TargetDiseaseEvidence } from "../lib/bio/targets.schemas";
import type { BioactivityVerification } from "../lib/bio/chembl.schemas";
import type { SafetySignalAssessment } from "../lib/bio/pharmacovigilance";
import type { NormalizedEntityGroup } from "../lib/bio/entities.schemas";
import type { BiomedicalClaimVerification } from "../lib/bio/biomedical.schemas";

// The Evidence Dossier Orchestrator composes the deterministic bio/evidence engines into
// one trust-scored dossier. These tests run FULLY OFFLINE over MOCKED engine deps plus a
// MOCKED Claude planner/narrator — no live network, no real LLM. The contracts under test:
//   1. SUBJECT-TYPE ROUTING — the sections that run are the subject type's applicable set,
//      narrowed by the (mocked) Claude plan and never expanded beyond it.
//   2. DETERMINISTIC score/grade — pure functions of the section signals, with documented
//      weighting; a safety flag with no support ⇒ contradicted; NO LLM decides the number.
//   3. NARRATIVE ISOLATION — a Claude planner/narrator failure still returns the verified
//      sections + deterministic score/grade (the LLM path is strictly additive).

// --- Engine mock factories --------------------------------------------------------

function genetic(verdict: GeneticAssociationResult["verdict"]): GeneticAssociationResult {
  return {
    verdict,
    disease: "d",
    gene: "g",
    variant: null,
    minPValue: verdict === "genome_wide_significant" ? 1e-12 : null,
    thresholds: { genomeWideSignificant: 5e-8, suggestive: 1e-5 },
    supporting: {
      gwas:
        verdict === "genome_wide_significant"
          ? [{ rsId: "rs1", gene: "g", trait: "d", pValue: 1e-12, orBeta: 1.4, riskAllele: "rs1-A", study: "PMID:1" }]
          : [],
      clinvar: [],
    },
    rationale: `genetic:${verdict}`,
  };
}

function targetDisease(found: boolean, opts?: { drugs?: number; tractable?: boolean }): TargetDiseaseEvidence {
  return {
    found,
    target: { querySymbol: "PCSK9", ensemblId: found ? "ENSG00000169174" : null, approvedSymbol: "PCSK9", approvedName: null },
    disease: { queryName: "d", efoId: found ? "EFO_0004911" : null, name: null },
    overallScore: found ? 0.82 : null,
    datatypeScores: { genetic_association: found ? 0.9 : null, known_drug: null, literature: null, animal_model: null },
    knownDrugs:
      (opts?.drugs ?? 0) > 0
        ? Array.from({ length: opts!.drugs! }, (_, i) => ({
            drugId: `CHEMBL${i}`,
            drugName: `drug${i}`,
            mechanismOfAction: "inhibitor",
            phase: 4,
            status: "approved",
          }))
        : [],
    tractability: opts?.tractable ? [{ label: "Approved Drug", modality: "SM", value: true }] : [],
  };
}

function bioactivity(potency: BioactivityVerification["potency"]["verdict"]): BioactivityVerification {
  return {
    drug: "vemurafenib",
    molecule: { queryName: "vemurafenib", chemblId: "CHEMBL1229517", prefName: "VEMURAFENIB", maxPhase: 4 },
    target: "BRAF",
    potency: { verdict: potency, claimedNM: 5, measuredNM: 31, ratio: potency === "overstated" ? 0.01 : 0.16, bandOrders: 1, standardType: "IC50" },
    phase: { verdict: "not_found", claimedPhase: null, chemblMaxPhase: 4 },
    mechanism: { verdict: "consistent", claimedMechanism: null, matchedTarget: "BRAF" },
    supporting: [{ targetChemblId: "CHEMBL5145", targetName: "BRAF", standardType: "IC50", standardValue: 31, standardUnits: "nM", pChembl: 7.5 }],
    rationale: `bio:${potency}`,
    attribution: "ChEMBL",
  };
}

function safety(signalOn: boolean | null): SafetySignalAssessment | null {
  if (signalOn === null) return null;
  return {
    drug: "rofecoxib",
    event: "myocardial infarction",
    a: 120, b: 400, c: 80, d: 90000, n: 90600,
    prr: signalOn ? 3.2 : 1.1,
    prrCiLower: 2.1, prrCiUpper: 4.9, ror: 3.4, rorCiLower: 2.2, rorCiUpper: 5.2,
    chiSquared: signalOn ? 55 : 0.5, chiSquaredYates: signalOn ? 52 : 0.4, pValue: signalOn ? 1e-12 : 0.5,
    informationComponent: 1.5, ic025: signalOn ? 1.1 : -0.2,
    signal: signalOn,
  };
}

function entityGroups(n: number): NormalizedEntityGroup[] {
  return Array.from({ length: n }, (_, i) => ({
    type: "gene" as const,
    normalizedId: `NCBI Gene:${i + 1}`,
    mentions: [`GENE${i}`],
    offsets: [],
    count: 1,
  }));
}

function biomedical(overall: BiomedicalClaimVerification["overallVerdict"]): BiomedicalClaimVerification {
  return {
    claim: "a claim",
    entities: { gene: "g", disease: "d", chemical: null, variant: null, variantRsId: null },
    checks: [
      { kind: "genetic_association", verdict: "genome_wide_significant", summary: "s", source: "EBI GWAS Catalog + NCBI ClinVar", detail: {} },
    ],
    overallVerdict: overall,
    rationale: `biomed:${overall}`,
  };
}

// A deps object whose engines are all spies so a test can assert exactly which ran, plus
// a mock planner/narrator. Defaults are honest-empty so a section that runs but isn't the
// focus contributes nothing.
function spyDeps(overrides: Partial<DossierDeps> = {}): {
  deps: DossierDeps;
  spies: {
    geneticAssociation: ReturnType<typeof vi.fn>;
    targetDisease: ReturnType<typeof vi.fn>;
    bioactivity: ReturnType<typeof vi.fn>;
    safetySignal: ReturnType<typeof vi.fn>;
    annotate: ReturnType<typeof vi.fn>;
    biomedicalClaim: ReturnType<typeof vi.fn>;
    clinicalTrials: ReturnType<typeof vi.fn>;
    plan: ReturnType<typeof vi.fn>;
    narrate: ReturnType<typeof vi.fn>;
  };
} {
  const spies = {
    geneticAssociation: (overrides.geneticAssociation as ReturnType<typeof vi.fn>) ?? vi.fn(async () => genetic("no_association_found")),
    targetDisease: (overrides.targetDisease as ReturnType<typeof vi.fn>) ?? vi.fn(async () => targetDisease(false)),
    bioactivity: (overrides.bioactivity as ReturnType<typeof vi.fn>) ?? vi.fn(async () => bioactivity("not_found")),
    safetySignal: (overrides.safetySignal as ReturnType<typeof vi.fn>) ?? vi.fn(async () => null as SafetySignalAssessment | null),
    annotate: (overrides.annotate as ReturnType<typeof vi.fn>) ?? vi.fn(async () => [] as NormalizedEntityGroup[]),
    biomedicalClaim: (overrides.biomedicalClaim as ReturnType<typeof vi.fn>) ?? vi.fn(async () => biomedical("insufficient_evidence")),
    clinicalTrials: (overrides.clinicalTrials as ReturnType<typeof vi.fn>) ?? vi.fn(async () => null as ClinicalTrialsResult | null),
    // Default plan: choose ALL applicable sections (identity narrowing).
    plan:
      (overrides.plan as ReturnType<typeof vi.fn>) ??
      vi.fn(async (input: { applicable: readonly SectionName[] }): Promise<DossierPlan> => ({
        sections: [...input.applicable],
        rationale: "all applicable",
      })),
    narrate:
      (overrides.narrate as ReturnType<typeof vi.fn>) ??
      vi.fn(async (): Promise<DossierNarrative> => ({ headline: "H", summary: "S" })),
  };
  const deps: DossierDeps = {
    ...overrides,
    geneticAssociation: spies.geneticAssociation as never,
    targetDisease: spies.targetDisease as never,
    bioactivity: spies.bioactivity as never,
    safetySignal: spies.safetySignal as never,
    annotate: spies.annotate as never,
    biomedicalClaim: spies.biomedicalClaim as never,
    clinicalTrials: spies.clinicalTrials as never,
    plan: spies.plan as never,
    narrate: spies.narrate as never,
  };
  return { deps, spies };
}

// ---------------------------------------------------------------------------

describe("buildEvidenceDossier — subject-type routing", () => {
  it("a TARGET dossier runs the target-applicable sections and skips claim/trial-only ones", async () => {
    const { deps, spies } = spyDeps({
      geneticAssociation: vi.fn(async () => genetic("genome_wide_significant")) as never,
      targetDisease: vi.fn(async () => targetDisease(true, { drugs: 2, tractable: true })) as never,
      annotate: vi.fn(async () => entityGroups(2)) as never,
    });

    const result = await buildEvidenceDossier(
      { subjectType: "target", subject: "PCSK9", disease: "hypercholesterolemia" },
      deps
    );

    const names = new Set(result.sections.map((s) => s.name));
    // Target-applicable sections all ran.
    expect(names).toEqual(
      new Set(["genetic_validation", "target_disease", "tractability", "existing_drugs", "safety_liabilities", "mechanism"])
    );
    // The claim verifier and efficacy pipeline are NOT part of a target dossier.
    expect(spies.biomedicalClaim).not.toHaveBeenCalled();
    expect(spies.clinicalTrials).not.toHaveBeenCalled();
    expect(() => EvidenceDossierSchema.parse(result)).not.toThrow();
  });

  it("a CLAIM dossier runs the composite claim verifier (the load-bearing check), not the target engines", async () => {
    const { deps, spies } = spyDeps({
      biomedicalClaim: vi.fn(async () => biomedical("supported")) as never,
      annotate: vi.fn(async () => entityGroups(1)) as never,
    });

    const result = await buildEvidenceDossier(
      { subjectType: "claim", subject: "PCSK9 loss-of-function protects against coronary artery disease" },
      deps
    );

    expect(spies.biomedicalClaim).toHaveBeenCalledTimes(1);
    expect(spies.geneticAssociation).not.toHaveBeenCalled();
    expect(spies.targetDisease).not.toHaveBeenCalled();
    expect(result.sections.some((s) => s.name === "claim_verification")).toBe(true);
  });

  it("the Claude plan can only NARROW the applicable set — a hallucinated section is dropped", async () => {
    // Planner returns a non-applicable section ("existing_drugs" is not in a disease
    // dossier) plus a bogus-but-typed one alongside a valid one.
    const { deps, spies } = spyDeps({
      annotate: vi.fn(async () => entityGroups(1)) as never,
      plan: vi.fn(async () => ({
        sections: ["mechanism", "existing_drugs", "genetic_validation"],
        rationale: "over-broad plan",
      })) as never,
    });

    const result = await buildEvidenceDossier({ subjectType: "disease", subject: "Alzheimer disease" }, deps);

    // disease applicable = [clinical_trials, mechanism]; only mechanism survives the
    // intersection (clinical_trials needs the pipeline dep, which returns null here).
    expect(result.sections.map((s) => s.name)).toEqual(["mechanism"]);
    // The non-applicable engines were never invoked despite the planner naming them.
    expect(spies.geneticAssociation).not.toHaveBeenCalled();
    expect(spies.targetDisease).not.toHaveBeenCalled();
  });

  it("a DRUG dossier runs bioactivity for existing_drugs and can flag a safety signal", async () => {
    const { deps, spies } = spyDeps({
      bioactivity: vi.fn(async () => bioactivity("confirmed_within_order")) as never,
      safetySignal: vi.fn(async () => safety(true)) as never,
      annotate: vi.fn(async () => entityGroups(1)) as never,
    });

    const result = await buildEvidenceDossier(
      { subjectType: "drug", subject: "rofecoxib", disease: "myocardial infarction" },
      deps
    );

    expect(spies.bioactivity).toHaveBeenCalledTimes(1);
    const existing = result.sections.find((s) => s.name === "existing_drugs");
    expect(existing?.signal).toBe("strong");
    const safetySection = result.sections.find((s) => s.name === "safety_liabilities");
    expect(safetySection?.signal).toBe("flag");
  });
});

describe("buildEvidenceDossier — clinical_trials via injected pipeline", () => {
  it("pooled efficacy evidence surfaces as a strong clinical_trials section", async () => {
    const trials: ClinicalTrialsResult = {
      usableStudies: 4,
      usedSourceCount: 6,
      poolable: true,
      citations: [{ source: "clinicaltrials", ref: "NCT1", detail: "trial" }],
      detail: { ok: true },
    };
    const { deps } = spyDeps({
      clinicalTrials: vi.fn(async () => trials) as never,
      biomedicalClaim: vi.fn(async () => biomedical("supported")) as never,
      annotate: vi.fn(async () => entityGroups(1)) as never,
    });

    const result = await buildEvidenceDossier(
      { subjectType: "claim", subject: "Drug X reduced major cardiac events by 30%" },
      deps
    );

    const ct = result.sections.find((s) => s.name === "clinical_trials");
    expect(ct?.signal).toBe("strong");
    expect(ct?.citations[0].ref).toBe("NCT1");
  });
});

describe("computeOverallScore / gradeDossier — deterministic, documented", () => {
  it("genome-wide genetic + known drug + no safety flag ⇒ high score, strong grade", () => {
    const sections = [
      { name: "genetic_validation" as const, signal: "strong" as const },
      { name: "existing_drugs" as const, signal: "strong" as const },
      { name: "target_disease" as const, signal: "strong" as const },
      { name: "safety_liabilities" as const, signal: "empty" as const },
    ];
    const score = computeOverallScore(sections);
    expect(score).toBeGreaterThanOrEqual(0.75);
    expect(gradeDossier(sections, score)).toBe("strong");
  });

  it("a safety flag with NO supporting section ⇒ contradicted", () => {
    const sections = [
      { name: "safety_liabilities" as const, signal: "flag" as const },
      { name: "mechanism" as const, signal: "empty" as const },
    ];
    const score = computeOverallScore(sections);
    expect(gradeDossier(sections, score)).toBe("contradicted");
  });

  it("a flag penalizes the score but strong support keeps the grade above contradicted", () => {
    const supported = [
      { name: "genetic_validation" as const, signal: "strong" as const },
      { name: "safety_liabilities" as const, signal: "flag" as const },
    ];
    const score = computeOverallScore(supported);
    const withoutFlag = computeOverallScore([{ name: "genetic_validation" as const, signal: "strong" as const }]);
    expect(score).toBeLessThan(withoutFlag);
    expect(gradeDossier(supported, score)).not.toBe("contradicted");
  });

  it("no sections ⇒ score 0, weak grade", () => {
    expect(computeOverallScore([])).toBe(0);
    expect(gradeDossier([], 0)).toBe("weak");
  });

  it("weaker signals band into emerging / moderate", () => {
    const moderate = [{ name: "genetic_validation" as const, signal: "moderate" as const }];
    const mscore = computeOverallScore(moderate);
    expect(mscore).toBeCloseTo(0.6, 5);
    expect(gradeDossier(moderate, mscore)).toBe("moderate");

    const present = [{ name: "mechanism" as const, signal: "present" as const }];
    const pscore = computeOverallScore(present);
    expect(pscore).toBeCloseTo(0.4, 5);
    expect(gradeDossier(present, pscore)).toBe("emerging");
  });
});

describe("buildEvidenceDossier — narrative isolation (LLM path is strictly additive)", () => {
  it("a NARRATOR failure still returns the verified sections and deterministic score/grade", async () => {
    const { deps } = spyDeps({
      geneticAssociation: vi.fn(async () => genetic("genome_wide_significant")) as never,
      targetDisease: vi.fn(async () => targetDisease(true, { drugs: 1, tractable: true })) as never,
      annotate: vi.fn(async () => entityGroups(1)) as never,
      narrate: vi.fn(async () => {
        throw new Error("Claude narrator unavailable");
      }) as never,
    });

    const result = await buildEvidenceDossier(
      { subjectType: "target", subject: "PCSK9", disease: "hypercholesterolemia" },
      deps
    );

    // Narrative is null, but the verified sections and deterministic verdict stand.
    expect(result.narrative).toBeNull();
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.overallGrade).toBe("strong");
    expect(result.overallScore).toBeGreaterThan(0);
    expect(() => EvidenceDossierSchema.parse(result)).not.toThrow();
  });

  it("a PLANNER failure falls back to running every applicable section", async () => {
    const { deps, spies } = spyDeps({
      geneticAssociation: vi.fn(async () => genetic("genome_wide_significant")) as never,
      targetDisease: vi.fn(async () => targetDisease(true)) as never,
      annotate: vi.fn(async () => entityGroups(1)) as never,
      plan: vi.fn(async () => {
        throw new Error("Claude planner unavailable");
      }) as never,
    });

    const result = await buildEvidenceDossier(
      { subjectType: "target", subject: "PCSK9", disease: "hypercholesterolemia" },
      deps
    );

    // planRationale is null (planner failed) but all applicable sections still ran.
    expect(result.planRationale).toBeNull();
    expect(new Set(result.sections.map((s) => s.name))).toEqual(
      new Set(DOSSIER_SECTIONS_BY_SUBJECT.target)
    );
    expect(spies.narrate).toHaveBeenCalledTimes(1);
  });

  it("the narrator is handed ONLY the verified sections + deterministic score (no raw engine internals to invent from)", async () => {
    const narrate = vi.fn(async (_input: unknown) => ({ headline: "H", summary: "S" }));
    const { deps } = spyDeps({
      geneticAssociation: vi.fn(async () => genetic("genome_wide_significant")) as never,
      targetDisease: vi.fn(async () => targetDisease(true)) as never,
      annotate: vi.fn(async () => entityGroups(1)) as never,
      narrate: narrate as never,
    });

    const result = await buildEvidenceDossier(
      { subjectType: "target", subject: "PCSK9", disease: "hypercholesterolemia" },
      deps
    );

    const arg = narrate.mock.calls[0][0] as unknown as {
      sections: unknown[];
      overallScore: number;
      overallGrade: string;
    };
    // The narrator receives the same sections and the deterministic score/grade it must
    // not recompute — proving the number is decided before the LLM ever sees it.
    expect(arg.sections).toEqual(result.sections);
    expect(arg.overallScore).toBe(result.overallScore);
    expect(arg.overallGrade).toBe(result.overallGrade);
  });

  it("all-empty sections ⇒ honest weak dossier, narrative still attempted over the empty sections", async () => {
    const { deps } = spyDeps({
      // every engine honest-empty (defaults), annotate empty ⇒ mechanism empty
      annotate: vi.fn(async () => [] as NormalizedEntityGroup[]) as never,
    });

    const result = await buildEvidenceDossier(
      { subjectType: "target", subject: "OBSCUREGENE", disease: "some disease" },
      deps
    );

    expect(result.overallScore).toBe(0);
    expect(result.overallGrade).toBe("weak");
    // Sections still surfaced for auditability even when all empty.
    expect(result.sections.length).toBeGreaterThan(0);
  });
});
