import { describe, it, expect, vi } from "vitest";
import {
  validateBiomarker,
  deriveValidationLevel,
  summarizeBiomarker,
  type BiomarkerDeps,
} from "../lib/bio/biomarker";
import {
  BiomarkerValidationSchema,
  type BiomarkerEvidence,
} from "../lib/bio/biomarker.schemas";
import type { GeneticAssociationResult } from "../lib/bio/genetics.schemas";
import type { TargetDiseaseEvidence } from "../lib/bio/targets.schemas";
import type { PmidAnnotation } from "../lib/bio/entities.schemas";
import type { PgxVerificationResult } from "../lib/bio/pharmgkb.schemas";

// These tests exercise the biomarker-validation assembly over MOCKED component engines
// — no live network, no LLM. The contract under test: the validationLevel is a PURE,
// DETERMINISTIC function of the assembled component strengths, per the documented rules
// (genome-wide genetic + literature co-mention -> analytically_grounded; only weak
// literature -> weak; nothing -> unsupported). Component failures degrade to honest empty.

// ---------------------------------------------------------------------------
// Mock builders for each injected engine's return value.
// ---------------------------------------------------------------------------

function geneticResult(
  verdict: GeneticAssociationResult["verdict"],
  minPValue: number | null = null
): GeneticAssociationResult {
  return {
    verdict,
    disease: "disease",
    gene: "GENE",
    variant: null,
    minPValue,
    thresholds: { genomeWideSignificant: 5e-8, suggestive: 1e-5 },
    supporting: { gwas: [], clinvar: [] },
    rationale: "mock",
  };
}

function targetEvidence(geneticScore: number | null): TargetDiseaseEvidence {
  return {
    found: geneticScore !== null,
    target: {
      querySymbol: "GENE",
      ensemblId: geneticScore !== null ? "ENSG0" : null,
      approvedSymbol: geneticScore !== null ? "GENE" : null,
      approvedName: null,
    },
    disease: { queryName: "disease", efoId: "EFO_0", name: "disease" },
    overallScore: geneticScore,
    datatypeScores: {
      genetic_association: geneticScore,
      known_drug: null,
      literature: null,
      animal_model: null,
    },
    knownDrugs: [],
    tractability: [],
  };
}

// A PubTator annotation naming which of biomarker/disease entities were resolved.
function annotations(opts: {
  biomarker?: string;
  disease?: string;
}): PmidAnnotation[] {
  const entities = [];
  if (opts.biomarker) {
    entities.push({
      text: opts.biomarker,
      type: "gene" as const,
      normalizedId: "NCBI Gene:1",
      offsets: [],
    });
  }
  if (opts.disease) {
    entities.push({
      text: opts.disease,
      type: "disease" as const,
      normalizedId: "MESH:D1",
      offsets: [],
    });
  }
  return entities.length > 0 ? [{ pmid: null, entities }] : [];
}

function pgxResult(
  verdict: PgxVerificationResult["verdict"],
  level: PgxVerificationResult["strongestEvidenceLevel"]
): PgxVerificationResult {
  return {
    verdict,
    gene: "GENE",
    variant: null,
    drug: "drug",
    claimedEffect: null,
    strongestEvidenceLevel: level,
    strongest: null,
    annotations: [],
    rationale: "mock",
    attribution: "PharmGKB / ClinPGx CC BY-SA 4.0",
  };
}

// Assemble a full BiomarkerDeps from per-engine return values. Each defaults to an
// honest empty signal so a test only specifies the components it cares about.
function makeDeps(config: {
  genetic?: GeneticAssociationResult;
  target?: TargetDiseaseEvidence;
  literature?: PmidAnnotation[];
  pgx?: PgxVerificationResult;
}): BiomarkerDeps {
  return {
    verifyGeneticAssociation: vi.fn(
      async () => config.genetic ?? geneticResult("no_association_found")
    ),
    targetDiseaseEvidence: vi.fn(async () => config.target ?? targetEvidence(null)),
    annotateText: vi.fn(async () => config.literature ?? []),
    verifyPgxClaim: vi.fn(
      async () => config.pgx ?? pgxResult("not_found", null)
    ),
  };
}

// ---------------------------------------------------------------------------
// deriveValidationLevel — pure rule table (no async, no engines)
// ---------------------------------------------------------------------------

function evidence(partial: Partial<BiomarkerEvidence>): BiomarkerEvidence {
  return {
    genetic: { assessed: true, verdict: "no_association_found", strength: "none", minPValue: null },
    targetScore: { assessed: true, associationFound: false, overallScore: null, geneticScore: null },
    literature: { assessed: true, biomarkerGrounded: false, diseaseGrounded: false, strength: "none" },
    pharmacogenomic: { assessed: false, verdict: null, strongestEvidenceLevel: null, attribution: null },
    ...partial,
  };
}

describe("deriveValidationLevel — deterministic rule table", () => {
  it("genome-wide genetic + literature co-mention -> analytically_grounded", () => {
    const { validationLevel } = deriveValidationLevel(
      evidence({
        genetic: { assessed: true, verdict: "genome_wide_significant", strength: "genome_wide", minPValue: 1e-12 },
        literature: { assessed: true, biomarkerGrounded: true, diseaseGrounded: true, strength: "co_mention" },
      })
    );
    expect(validationLevel).toBe("analytically_grounded");
  });

  it("ClinVar pathogenic + literature co-mention -> analytically_grounded", () => {
    const { validationLevel } = deriveValidationLevel(
      evidence({
        genetic: { assessed: true, verdict: "clinvar_pathogenic", strength: "clinvar_pathogenic", minPValue: null },
        literature: { assessed: true, biomarkerGrounded: true, diseaseGrounded: true, strength: "co_mention" },
      })
    );
    expect(validationLevel).toBe("analytically_grounded");
  });

  it("high Open Targets genetic score + co-mention -> analytically_grounded", () => {
    const { validationLevel } = deriveValidationLevel(
      evidence({
        targetScore: { assessed: true, associationFound: true, overallScore: 0.8, geneticScore: 0.7 },
        literature: { assessed: true, biomarkerGrounded: true, diseaseGrounded: true, strength: "co_mention" },
      })
    );
    expect(validationLevel).toBe("analytically_grounded");
  });

  it("strong genetic WITHOUT co-mention -> emerging", () => {
    const { validationLevel } = deriveValidationLevel(
      evidence({
        genetic: { assessed: true, verdict: "genome_wide_significant", strength: "genome_wide", minPValue: 1e-12 },
        literature: { assessed: true, biomarkerGrounded: false, diseaseGrounded: false, strength: "none" },
      })
    );
    expect(validationLevel).toBe("emerging");
  });

  it("suggestive genetic + co-mention -> emerging", () => {
    const { validationLevel } = deriveValidationLevel(
      evidence({
        genetic: { assessed: true, verdict: "suggestive", strength: "suggestive", minPValue: 5e-6 },
        literature: { assessed: true, biomarkerGrounded: true, diseaseGrounded: true, strength: "co_mention" },
      })
    );
    expect(validationLevel).toBe("emerging");
  });

  it("strong (1A) PGx annotation alone -> emerging", () => {
    const { validationLevel } = deriveValidationLevel(
      evidence({
        pharmacogenomic: { assessed: true, verdict: "high_confidence", strongestEvidenceLevel: "1A", attribution: "x" },
      })
    );
    expect(validationLevel).toBe("emerging");
  });

  it("only literature co-mention -> weak", () => {
    const { validationLevel } = deriveValidationLevel(
      evidence({
        literature: { assessed: true, biomarkerGrounded: true, diseaseGrounded: true, strength: "co_mention" },
      })
    );
    expect(validationLevel).toBe("weak");
  });

  it("only a suggestive genetic signal (no co-mention) -> weak", () => {
    const { validationLevel } = deriveValidationLevel(
      evidence({
        genetic: { assessed: true, verdict: "suggestive", strength: "suggestive", minPValue: 5e-6 },
      })
    );
    expect(validationLevel).toBe("weak");
  });

  it("conflicting ClinVar picture -> weak", () => {
    const { validationLevel } = deriveValidationLevel(
      evidence({
        genetic: { assessed: true, verdict: "conflicting", strength: "conflicting", minPValue: null },
      })
    );
    expect(validationLevel).toBe("weak");
  });

  it("reported-not-significant genetic -> weak", () => {
    const { validationLevel } = deriveValidationLevel(
      evidence({
        genetic: { assessed: true, verdict: "reported_not_significant", strength: "reported", minPValue: null },
      })
    );
    expect(validationLevel).toBe("weak");
  });

  it("lower-tier (level 3) PGx annotation -> weak", () => {
    const { validationLevel } = deriveValidationLevel(
      evidence({
        pharmacogenomic: { assessed: true, verdict: "preliminary", strongestEvidenceLevel: "3", attribution: "x" },
      })
    );
    expect(validationLevel).toBe("weak");
  });

  it("nothing assembled -> unsupported", () => {
    const { validationLevel } = deriveValidationLevel(evidence({}));
    expect(validationLevel).toBe("unsupported");
  });

  it("partial literature grounding alone (only disease) -> unsupported", () => {
    const { validationLevel } = deriveValidationLevel(
      evidence({
        literature: { assessed: true, biomarkerGrounded: false, diseaseGrounded: true, strength: "partial" },
      })
    );
    expect(validationLevel).toBe("unsupported");
  });
});

// ---------------------------------------------------------------------------
// validateBiomarker — end-to-end assembly over mocked engines
// ---------------------------------------------------------------------------

describe("validateBiomarker — assembles evidence and derives the level", () => {
  it("genome-wide genetic + co-mention -> analytically_grounded (schema-valid)", async () => {
    const deps = makeDeps({
      genetic: geneticResult("genome_wide_significant", 3e-9),
      literature: annotations({ biomarker: "BRCA1", disease: "breast cancer" }),
    });

    const result = await validateBiomarker(
      { biomarker: "BRCA1", disease: "breast cancer" },
      deps
    );

    expect(() => BiomarkerValidationSchema.parse(result)).not.toThrow();
    expect(result.validationLevel).toBe("analytically_grounded");
    expect(result.evidence.genetic.strength).toBe("genome_wide");
    expect(result.evidence.genetic.minPValue).toBe(3e-9);
    expect(result.evidence.literature.strength).toBe("co_mention");
    expect(result.biomarker).toBe("BRCA1");
  });

  it("only weak literature co-mention -> weak", async () => {
    const deps = makeDeps({
      literature: annotations({ biomarker: "GENEX", disease: "some disease" }),
    });

    const result = await validateBiomarker(
      { biomarker: "GENEX", disease: "some disease" },
      deps
    );

    expect(result.validationLevel).toBe("weak");
    expect(result.evidence.genetic.strength).toBe("none");
    expect(result.evidence.literature.strength).toBe("co_mention");
  });

  it("no evidence anywhere -> unsupported (honest empty)", async () => {
    const deps = makeDeps({});
    const result = await validateBiomarker(
      { biomarker: "NOPE", disease: "nothing" },
      deps
    );

    expect(result.validationLevel).toBe("unsupported");
    expect(result.evidence.genetic.strength).toBe("none");
    expect(result.evidence.literature.strength).toBe("none");
    expect(result.evidence.targetScore.associationFound).toBe(false);
    expect(result.evidence.pharmacogenomic.assessed).toBe(false);
  });

  it("does NOT assess pharmacogenomics when no drug is provided", async () => {
    const pgxSpy = vi.fn(async () => pgxResult("high_confidence", "1A"));
    const deps: BiomarkerDeps = {
      ...makeDeps({}),
      verifyPgxClaim: pgxSpy,
    };

    const result = await validateBiomarker(
      { biomarker: "GENE", disease: "disease" },
      deps
    );

    expect(pgxSpy).not.toHaveBeenCalled();
    expect(result.evidence.pharmacogenomic.assessed).toBe(false);
    expect(result.drug).toBeNull();
  });

  it("assesses pharmacogenomics and reaches emerging when a drug + 1A annotation is present", async () => {
    const deps = makeDeps({ pgx: pgxResult("high_confidence", "1A") });
    const result = await validateBiomarker(
      { biomarker: "CYP2C19", disease: "clopidogrel resistance", drug: "clopidogrel" },
      deps
    );

    expect(result.evidence.pharmacogenomic.assessed).toBe(true);
    expect(result.evidence.pharmacogenomic.strongestEvidenceLevel).toBe("1A");
    expect(result.validationLevel).toBe("emerging");
    expect(result.drug).toBe("clopidogrel");
  });

  it("degrades to an honest empty component when an engine throws (no fabrication)", async () => {
    const deps: BiomarkerDeps = {
      ...makeDeps({
        literature: annotations({ biomarker: "GENE", disease: "disease" }),
      }),
      verifyGeneticAssociation: vi.fn(async () => {
        throw new Error("upstream down");
      }),
    };

    const result = await validateBiomarker(
      { biomarker: "GENE", disease: "disease" },
      deps
    );

    // Genetic component honestly empty; the rest still assembled -> weak (co-mention).
    expect(result.evidence.genetic.assessed).toBe(false);
    expect(result.evidence.genetic.strength).toBe("none");
    expect(result.validationLevel).toBe("weak");
  });
});

// ---------------------------------------------------------------------------
// summarizeBiomarker — optional Claude layer references only assembled data
// ---------------------------------------------------------------------------

describe("summarizeBiomarker — optional Claude layer", () => {
  it("passes the deterministic level to the model and validates the JSON summary", async () => {
    const deps = makeDeps({
      genetic: geneticResult("genome_wide_significant", 3e-9),
      literature: annotations({ biomarker: "BRCA1", disease: "breast cancer" }),
    });
    const validation = await validateBiomarker(
      { biomarker: "BRCA1", disease: "breast cancer" },
      deps
    );

    const callJson = vi.fn(
      async (params: { user: string; schema: { parse: (v: unknown) => unknown } }) => {
        // The prompt must carry the deterministic level verbatim.
        expect(params.user).toContain("analytically_grounded");
        return params.schema.parse({
          summary: "BRCA1 is strongly validated for breast cancer.",
          keyEvidence: "genetic",
        });
      }
    );

    const summary = await summarizeBiomarker(validation, callJson as never);

    expect(callJson).toHaveBeenCalledTimes(1);
    expect(summary.keyEvidence).toBe("genetic");
    expect(summary.summary.length).toBeGreaterThan(0);
  });

  it("rejects a model summary that invents an evidence key outside the assembled set", async () => {
    const deps = makeDeps({});
    const validation = await validateBiomarker(
      { biomarker: "GENE", disease: "disease" },
      deps
    );

    const callJson = vi.fn(async (params: { schema: { parse: (v: unknown) => unknown } }) =>
      params.schema.parse({ summary: "bad", keyEvidence: "made_up" })
    );

    await expect(summarizeBiomarker(validation, callJson as never)).rejects.toThrow();
  });
});
