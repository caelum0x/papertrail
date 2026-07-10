import { describe, it, expect, vi } from "vitest";
import {
  verifyBiomedicalClaim,
  extractClaimEntities,
  combineVerdicts,
  type BiomedicalDeps,
} from "../lib/bio/verifyBiomedicalClaim";
import { BiomedicalClaimVerificationSchema } from "../lib/bio/biomedical.schemas";
import type { NormalizedEntityGroup } from "../lib/bio/entities.schemas";
import type { GeneticAssociationResult } from "../lib/bio/genetics.schemas";
import type { PathogenicityVerification } from "../lib/bio/variant.schemas";
import type { TargetDiseaseEvidence } from "../lib/bio/targets.schemas";
import type { SafetySignalAssessment } from "../lib/bio/pharmacovigilance";
import type { BioactivityVerification } from "../lib/bio/chembl.schemas";
import type { PgxVerificationResult } from "../lib/bio/pharmgkb.schemas";

// The unified biomedical claim verifier composes the six deterministic bio engines into
// one verdict. These tests run FULLY OFFLINE over MOCKED engine deps — no live network,
// no real LLM. The contracts under test:
//   1. ENTITY-DRIVEN ROUTING — the entities PubTator resolves decide which engines run.
//      A gene+disease claim runs genetics+pathogenicity, NOT bioactivity/PGx.
//   2. DETERMINISTIC overall verdict — an overstated component ⇒ overstated overall;
//      all-positive ⇒ supported; mixed ⇒ partially_supported.
//   3. HONEST insufficient_evidence — no entity resolves, or every check is empty.

// --- Entity-group builders (what PubTator's normalizeEntities would return) -------

function geneGroup(symbol: string): NormalizedEntityGroup {
  return { type: "gene", normalizedId: "NCBI Gene:1", mentions: [symbol], offsets: [], count: 1 };
}
function diseaseGroup(name: string): NormalizedEntityGroup {
  return { type: "disease", normalizedId: "MESH:D000001", mentions: [name], offsets: [], count: 1 };
}
function chemicalGroup(name: string): NormalizedEntityGroup {
  return { type: "chemical", normalizedId: "MESH:C000001", mentions: [name], offsets: [], count: 1 };
}
function variantGroup(rsId: string): NormalizedEntityGroup {
  return { type: "variant", normalizedId: `dbSNP:${rsId}`, mentions: [rsId], offsets: [], count: 1 };
}

// --- Engine mock factories --------------------------------------------------------

function genetic(verdict: GeneticAssociationResult["verdict"]): GeneticAssociationResult {
  return {
    verdict,
    disease: "d",
    gene: "g",
    variant: null,
    minPValue: null,
    thresholds: { genomeWideSignificant: 5e-8, suggestive: 1e-5 },
    supporting: { gwas: [], clinvar: [] },
    rationale: `genetic:${verdict}`,
  };
}

function pathogenicity(
  verdict: PathogenicityVerification["verdict"]
): PathogenicityVerification {
  return {
    verdict,
    query: { rsId: "rs1", hgvs: null, gene: null, condition: null, claimedSignificance: null },
    bestRecord: null,
    records: [],
    rationale: `path:${verdict}`,
  };
}

function targetDisease(found: boolean): TargetDiseaseEvidence {
  return {
    found,
    target: { querySymbol: "t", ensemblId: found ? "ENSG1" : null, approvedSymbol: null, approvedName: null },
    disease: { queryName: "d", efoId: found ? "EFO_1" : null, name: null },
    overallScore: found ? 0.7 : null,
    datatypeScores: { genetic_association: null, known_drug: null, literature: null, animal_model: null },
    knownDrugs: [],
    tractability: [],
  };
}

function bioactivity(
  potency: BioactivityVerification["potency"]["verdict"]
): BioactivityVerification {
  return {
    drug: "drug",
    molecule: { queryName: "drug", chemblId: "CHEMBL1", prefName: "Drug", maxPhase: null },
    target: "BRAF",
    potency: {
      verdict: potency,
      claimedNM: 5,
      measuredNM: 500,
      ratio: potency === "overstated" ? 0.01 : 1,
      bandOrders: 1,
      standardType: "IC50",
    },
    phase: { verdict: "not_found", claimedPhase: null, chemblMaxPhase: null },
    mechanism: { verdict: "consistent", claimedMechanism: null, matchedTarget: "BRAF" },
    supporting: [],
    rationale: `bio:${potency}`,
    attribution: "ChEMBL",
  };
}

function pgx(verdict: PgxVerificationResult["verdict"]): PgxVerificationResult {
  return {
    verdict,
    gene: "CYP2C19",
    variant: null,
    drug: "clopidogrel",
    claimedEffect: null,
    strongestEvidenceLevel: verdict === "not_found" ? null : "1A",
    strongest: null,
    annotations: [],
    rationale: `pgx:${verdict}`,
    attribution: "PharmGKB",
  };
}

// A deps object whose engines are all spies, so a test can assert exactly which ran.
function spyDeps(overrides: Partial<BiomedicalDeps> = {}): {
  deps: BiomedicalDeps;
  spies: {
    geneticAssociation: ReturnType<typeof vi.fn>;
    pathogenicity: ReturnType<typeof vi.fn>;
    targetDisease: ReturnType<typeof vi.fn>;
    safetySignal: ReturnType<typeof vi.fn>;
    bioactivity: ReturnType<typeof vi.fn>;
    pgx: ReturnType<typeof vi.fn>;
  };
} {
  // Each engine spy: use the test's override when provided (so assertions on the spy
  // reflect what actually ran), else a default honest-empty stub. Every engine is a
  // spy so a test can assert exactly which engines the router invoked.
  const spies = {
    geneticAssociation:
      (overrides.geneticAssociation as ReturnType<typeof vi.fn>) ??
      vi.fn(async () => genetic("no_association_found")),
    pathogenicity:
      (overrides.pathogenicity as ReturnType<typeof vi.fn>) ??
      vi.fn(async () => pathogenicity("not_found")),
    targetDisease:
      (overrides.targetDisease as ReturnType<typeof vi.fn>) ??
      vi.fn(async () => targetDisease(false)),
    safetySignal:
      (overrides.safetySignal as ReturnType<typeof vi.fn>) ??
      vi.fn(async () => null as SafetySignalAssessment | null),
    bioactivity:
      (overrides.bioactivity as ReturnType<typeof vi.fn>) ??
      vi.fn(async () => bioactivity("not_found")),
    pgx: (overrides.pgx as ReturnType<typeof vi.fn>) ?? vi.fn(async () => pgx("not_found")),
  };
  const deps: BiomedicalDeps = {
    ...overrides,
    geneticAssociation: spies.geneticAssociation as never,
    pathogenicity: spies.pathogenicity as never,
    targetDisease: spies.targetDisease as never,
    safetySignal: spies.safetySignal as never,
    bioactivity: spies.bioactivity as never,
    pgx: spies.pgx as never,
  };
  return { deps, spies };
}

// ---------------------------------------------------------------------------

describe("extractClaimEntities — distills PubTator groups to routing strings", () => {
  it("takes the first mention per type and pulls an rsID from a dbSNP normalizedId", () => {
    const entities = extractClaimEntities([
      geneGroup("PCSK9"),
      diseaseGroup("coronary artery disease"),
      variantGroup("rs334"),
      chemicalGroup("aspirin"),
    ]);
    expect(entities).toEqual({
      gene: "PCSK9",
      disease: "coronary artery disease",
      chemical: "aspirin",
      variant: "rs334",
      variantRsId: "rs334",
    });
  });

  it("returns all-null when no routable entity is present", () => {
    const entities = extractClaimEntities([
      { type: "species", normalizedId: "9606", mentions: ["human"], offsets: [], count: 1 },
    ]);
    expect(entities).toEqual({
      gene: null,
      disease: null,
      chemical: null,
      variant: null,
      variantRsId: null,
    });
  });
});

describe("verifyBiomedicalClaim — entity-driven routing", () => {
  it("a gene+disease claim runs genetics AND pathogenicity is NOT run without a variant, and bioactivity/PGx are skipped", async () => {
    const { deps, spies } = spyDeps({
      annotate: async () => [geneGroup("APOE"), diseaseGroup("Alzheimer disease")],
    });

    const result = await verifyBiomedicalClaim({ claim: "APOE is associated with Alzheimer disease" }, deps);

    // Genetics runs (gene + disease).
    expect(spies.geneticAssociation).toHaveBeenCalledTimes(1);
    // No variant → pathogenicity does NOT run.
    expect(spies.pathogenicity).not.toHaveBeenCalled();
    // No drug → none of the drug-keyed engines run.
    expect(spies.bioactivity).not.toHaveBeenCalled();
    expect(spies.pgx).not.toHaveBeenCalled();
    expect(spies.targetDisease).not.toHaveBeenCalled();
    expect(spies.safetySignal).not.toHaveBeenCalled();

    // Only the genetic_association check is surfaced.
    expect(result.checks.map((c) => c.kind)).toEqual(["genetic_association"]);
    expect(() => BiomedicalClaimVerificationSchema.parse(result)).not.toThrow();
  });

  it("a variant+disease claim runs BOTH genetics and pathogenicity, and NOT bioactivity", async () => {
    const { deps, spies } = spyDeps({
      annotate: async () => [variantGroup("rs429358"), diseaseGroup("Alzheimer disease")],
      geneticAssociation: vi.fn(async () => genetic("genome_wide_significant")) as never,
      pathogenicity: vi.fn(async () => pathogenicity("confirmed")) as never,
    });

    const result = await verifyBiomedicalClaim(
      { claim: "rs429358 is associated with Alzheimer disease" },
      deps
    );

    expect(spies.geneticAssociation).toHaveBeenCalledTimes(1);
    expect(spies.pathogenicity).toHaveBeenCalledTimes(1);
    expect(spies.bioactivity).not.toHaveBeenCalled();

    // rsID is passed through to the genetics engine (variant, not gene).
    const geneticArg = spies.geneticAssociation.mock.calls[0][0];
    expect(geneticArg.variant).toBe("rs429358");

    expect(new Set(result.checks.map((c) => c.kind))).toEqual(
      new Set(["genetic_association", "variant_pathogenicity"])
    );
  });

  it("a drug+disease claim runs target–disease AND safety AND bioactivity, but NOT genetics/pathogenicity", async () => {
    const { deps, spies } = spyDeps({
      annotate: async () => [chemicalGroup("rofecoxib"), diseaseGroup("myocardial infarction")],
      targetDisease: vi.fn(async () => targetDisease(true)) as never,
    });

    const result = await verifyBiomedicalClaim(
      { claim: "rofecoxib increases risk of myocardial infarction" },
      deps
    );

    expect(spies.targetDisease).toHaveBeenCalledTimes(1);
    expect(spies.safetySignal).toHaveBeenCalledTimes(1);
    expect(spies.bioactivity).toHaveBeenCalledTimes(1);
    expect(spies.geneticAssociation).not.toHaveBeenCalled();
    expect(spies.pathogenicity).not.toHaveBeenCalled();

    // Safety returned null (honest empty) so it is dropped; target_disease + bioactivity remain.
    expect(new Set(result.checks.map((c) => c.kind))).toEqual(
      new Set(["target_disease", "bioactivity"])
    );
  });

  it("a gene/variant+drug claim runs pharmacogenomics", async () => {
    const { deps, spies } = spyDeps({
      annotate: async () => [geneGroup("CYP2C19"), chemicalGroup("clopidogrel")],
      pgx: vi.fn(async () => pgx("high_confidence")) as never,
    });

    const result = await verifyBiomedicalClaim(
      { claim: "CYP2C19 affects response to clopidogrel" },
      deps
    );

    expect(spies.pgx).toHaveBeenCalledTimes(1);
    // No disease → target-disease + safety do not run; genetics needs a disease too.
    expect(spies.geneticAssociation).not.toHaveBeenCalled();
    expect(spies.targetDisease).not.toHaveBeenCalled();
    expect(result.checks.some((c) => c.kind === "pharmacogenomics")).toBe(true);
  });
});

describe("verifyBiomedicalClaim — deterministic overall verdict", () => {
  it("an overstated component ⇒ overstated overall (dominates a positive check)", async () => {
    const { deps } = spyDeps({
      annotate: async () => [geneGroup("BRAF"), chemicalGroup("vemurafenib")],
      // Bioactivity overstated (claimed far more potent than measured).
      bioactivity: vi.fn(async () => bioactivity("overstated")) as never,
      // PGx positive — should NOT rescue an overstated axis.
      pgx: vi.fn(async () => pgx("high_confidence")) as never,
    });

    const result = await verifyBiomedicalClaim(
      { claim: "vemurafenib is a sub-nanomolar BRAF inhibitor" },
      deps
    );

    expect(result.overallVerdict).toBe("overstated");
    expect(result.rationale).toMatch(/overstated/i);
  });

  it("all-positive components ⇒ supported", async () => {
    const { deps } = spyDeps({
      annotate: async () => [variantGroup("rs429358"), diseaseGroup("Alzheimer disease")],
      geneticAssociation: vi.fn(async () => genetic("genome_wide_significant")) as never,
      pathogenicity: vi.fn(async () => pathogenicity("confirmed")) as never,
    });

    const result = await verifyBiomedicalClaim(
      { claim: "rs429358 is pathogenic for Alzheimer disease" },
      deps
    );

    expect(result.overallVerdict).toBe("supported");
  });

  it("mixed positive + contradicting ⇒ partially_supported", async () => {
    const { deps } = spyDeps({
      annotate: async () => [variantGroup("rs1"), diseaseGroup("some disease")],
      // Genetics contradicts (reported but not significant); pathogenicity confirms.
      geneticAssociation: vi.fn(async () => genetic("reported_not_significant")) as never,
      pathogenicity: vi.fn(async () => pathogenicity("confirmed")) as never,
    });

    const result = await verifyBiomedicalClaim({ claim: "rs1 causes some disease" }, deps);

    expect(result.overallVerdict).toBe("partially_supported");
  });

  it("evidence exists but none confirms ⇒ unsupported", async () => {
    const { deps } = spyDeps({
      annotate: async () => [geneGroup("GENE"), diseaseGroup("disease")],
      geneticAssociation: vi.fn(async () => genetic("reported_not_significant")) as never,
    });

    const result = await verifyBiomedicalClaim({ claim: "GENE causes disease" }, deps);

    expect(result.overallVerdict).toBe("unsupported");
  });
});

describe("verifyBiomedicalClaim — honest insufficient_evidence", () => {
  it("returns insufficient_evidence with no checks when no entity resolves", async () => {
    const { deps, spies } = spyDeps({ annotate: async () => [] });

    const result = await verifyBiomedicalClaim({ claim: "an untyped statement" }, deps);

    expect(result.overallVerdict).toBe("insufficient_evidence");
    expect(result.checks).toEqual([]);
    // No engine was even called.
    expect(spies.geneticAssociation).not.toHaveBeenCalled();
    expect(spies.bioactivity).not.toHaveBeenCalled();
    expect(result.rationale).toMatch(/no biomedical entities/i);
  });

  it("returns insufficient_evidence when every applicable check is an honest empty", async () => {
    const { deps } = spyDeps({
      annotate: async () => [geneGroup("GENE"), diseaseGroup("disease")],
      // Genetics returns no_association_found → empty signal.
      geneticAssociation: vi.fn(async () => genetic("no_association_found")) as never,
    });

    const result = await verifyBiomedicalClaim({ claim: "GENE causes disease" }, deps);

    expect(result.overallVerdict).toBe("insufficient_evidence");
    // The empty check is still surfaced for auditability, but drives no verdict.
    expect(result.checks).toHaveLength(1);
    expect(result.rationale).toMatch(/empty result/i);
  });

  it("degrades to an honest omission when an engine throws (no fabricated check)", async () => {
    const { deps } = spyDeps({
      annotate: async () => [variantGroup("rs1"), diseaseGroup("disease")],
      geneticAssociation: vi.fn(async () => {
        throw new Error("upstream down");
      }) as never,
      pathogenicity: vi.fn(async () => pathogenicity("confirmed")) as never,
    });

    const result = await verifyBiomedicalClaim({ claim: "rs1 causes disease" }, deps);

    // The failing genetics check is dropped; the surviving pathogenicity check stands.
    expect(result.checks.map((c) => c.kind)).toEqual(["variant_pathogenicity"]);
    expect(result.overallVerdict).toBe("supported");
  });
});

describe("combineVerdicts — the pure roll-up (unit)", () => {
  it("no signals ⇒ insufficient_evidence", () => {
    expect(combineVerdicts([]).overallVerdict).toBe("insufficient_evidence");
  });
  it("all empty ⇒ insufficient_evidence", () => {
    expect(combineVerdicts(["empty", "empty"]).overallVerdict).toBe("insufficient_evidence");
  });
  it("any overstated ⇒ overstated (even alongside positive)", () => {
    expect(combineVerdicts(["positive", "overstated"]).overallVerdict).toBe("overstated");
  });
  it("positive with no negative ⇒ supported", () => {
    expect(combineVerdicts(["positive", "empty"]).overallVerdict).toBe("supported");
  });
  it("positive + negative ⇒ partially_supported", () => {
    expect(combineVerdicts(["positive", "negative"]).overallVerdict).toBe("partially_supported");
  });
  it("only negative ⇒ unsupported", () => {
    expect(combineVerdicts(["negative", "empty"]).overallVerdict).toBe("unsupported");
  });
});
