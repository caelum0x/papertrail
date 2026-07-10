import { describe, it, expect } from "vitest";
import {
  classifyPgxAnnotations,
  selectStrongestAnnotation,
  normalizeClinicalAnnotation,
  lookupClinicalAnnotation,
  verifyPgxClaim,
  PHARMGKB_ATTRIBUTION,
  type PharmGkbDeps,
} from "../lib/bio/pharmgkb";
import type { ClinicalAnnotation } from "../lib/bio/pharmgkb.schemas";

// Deterministic pharmacogenomic-annotation verification over MOCKED PharmGKB /
// ClinPGx responses — no network. Locks the documented PharmGKB evidence-level
// ordering (1A > 1B > 2A > 2B > 3 > 4) → verdict banding, strongest-annotation
// selection, and the honest not_found empty.
//
// ATTRIBUTION: PharmGKB / ClinPGx clinical-annotation data is CC BY-SA 4.0
// (https://creativecommons.org/licenses/by-sa/4.0/). Test fixtures below are
// hand-written and illustrative, not verbatim PharmGKB content.

// --- fixtures ------------------------------------------------------------------

function ann(overrides: Partial<ClinicalAnnotation> = {}): ClinicalAnnotation {
  return {
    annotationId: "PA166000000",
    gene: "CYP2C19",
    variant: "rs4244285",
    drug: "clopidogrel",
    phenotypeCategory: "efficacy",
    evidenceLevel: "3",
    guideline: null,
    summary: "rs4244285 (CYP2C19); clopidogrel (level 3 Efficacy)",
    ...overrides,
  };
}

// A raw PharmGKB REST record shaped like the live `view=max` clinicalAnnotation API.
function rawRecord(
  levelTerm: string,
  opts: {
    types?: string[];
    gene?: string;
    rsid?: string;
    drug?: string;
    guideline?: string;
    name?: string;
  } = {}
): unknown {
  return {
    id: 981239556,
    accessionId: "PA166134613",
    name: opts.name ?? `${opts.rsid ?? "rs4244285"} (${opts.gene ?? "CYP2C19"}); ${opts.drug ?? "clopidogrel"} (level ${levelTerm})`,
    types: opts.types ?? ["Efficacy"],
    levelOfEvidence: { term: levelTerm, description: `Level ${levelTerm} description` },
    location: {
      rsid: opts.rsid ?? "rs4244285",
      displayName: opts.rsid ?? "rs4244285",
      genes: [{ objCls: "Gene", symbol: opts.gene ?? "CYP2C19", name: "cytochrome" }],
    },
    relatedChemicals: [{ objCls: "Chemical", name: opts.drug ?? "clopidogrel" }],
    relatedGuidelines: opts.guideline
      ? [{ objCls: "Guideline Annotation", name: opts.guideline }]
      : [],
    allelePhenotypes: [{ allele: "AA", phenotype: "reduced response" }],
  };
}

function depsReturning(payload: unknown): PharmGkbDeps {
  return { fetchJson: async () => payload };
}

// --- evidence-level → verdict banding ------------------------------------------

describe("classifyPgxAnnotations — deterministic verdict banding", () => {
  it("level 1A → high_confidence", () => {
    const r = classifyPgxAnnotations({
      gene: "CYP2C19",
      variant: "rs4244285",
      drug: "clopidogrel",
      claimedEffect: null,
      annotations: [ann({ evidenceLevel: "1A" })],
    });
    expect(r.verdict).toBe("high_confidence");
    expect(r.strongestEvidenceLevel).toBe("1A");
  });

  it("level 1B → high_confidence", () => {
    const r = classifyPgxAnnotations({
      gene: "CYP2C19", variant: "rs4244285", drug: "clopidogrel", claimedEffect: null,
      annotations: [ann({ evidenceLevel: "1B" })],
    });
    expect(r.verdict).toBe("high_confidence");
  });

  it("level 2A → moderate", () => {
    const r = classifyPgxAnnotations({
      gene: "CYP2C19", variant: "rs4244285", drug: "clopidogrel", claimedEffect: null,
      annotations: [ann({ evidenceLevel: "2A" })],
    });
    expect(r.verdict).toBe("moderate");
  });

  it("level 2B → moderate", () => {
    const r = classifyPgxAnnotations({
      gene: "CYP2C19", variant: "rs4244285", drug: "clopidogrel", claimedEffect: null,
      annotations: [ann({ evidenceLevel: "2B" })],
    });
    expect(r.verdict).toBe("moderate");
  });

  it("level 3 → preliminary", () => {
    const r = classifyPgxAnnotations({
      gene: "CYP2C19", variant: "rs4244285", drug: "clopidogrel", claimedEffect: null,
      annotations: [ann({ evidenceLevel: "3" })],
    });
    expect(r.verdict).toBe("preliminary");
  });

  it("level 4 → preliminary", () => {
    const r = classifyPgxAnnotations({
      gene: "CYP2C19", variant: "rs4244285", drug: "clopidogrel", claimedEffect: null,
      annotations: [ann({ evidenceLevel: "4" })],
    });
    expect(r.verdict).toBe("preliminary");
  });

  it("no annotations → not_found (honest empty)", () => {
    const r = classifyPgxAnnotations({
      gene: "CYP2C19", variant: "rs4244285", drug: "clopidogrel", claimedEffect: null,
      annotations: [],
    });
    expect(r.verdict).toBe("not_found");
    expect(r.strongest).toBeNull();
    expect(r.strongestEvidenceLevel).toBeNull();
  });
});

// --- strongest-annotation selection --------------------------------------------

describe("selectStrongestAnnotation — evidence-level ordering", () => {
  it("picks 1A over 2A over 4 regardless of input order", () => {
    const list = [ann({ evidenceLevel: "4" }), ann({ evidenceLevel: "1A" }), ann({ evidenceLevel: "2A" })];
    const strongest = selectStrongestAnnotation(list);
    expect(strongest?.evidenceLevel).toBe("1A");
  });

  it("1B beats 2A beats 2B beats 3 (full ordering)", () => {
    const list = [ann({ evidenceLevel: "3" }), ann({ evidenceLevel: "2B" }), ann({ evidenceLevel: "2A" }), ann({ evidenceLevel: "1B" })];
    expect(selectStrongestAnnotation(list)?.evidenceLevel).toBe("1B");
  });

  it("classify uses the strongest, not the first, annotation", () => {
    const r = classifyPgxAnnotations({
      gene: "CYP2C19", variant: "rs4244285", drug: "clopidogrel", claimedEffect: null,
      annotations: [ann({ evidenceLevel: "3" }), ann({ evidenceLevel: "1A", annotationId: "STRONG" })],
    });
    expect(r.verdict).toBe("high_confidence");
    expect(r.strongest?.annotationId).toBe("STRONG");
  });

  it("at equal level, prefers the annotation carrying a guideline", () => {
    const withGuide = ann({ evidenceLevel: "1A", annotationId: "G", guideline: "CPIC clopidogrel" });
    const noGuide = ann({ evidenceLevel: "1A", annotationId: "NG", guideline: null });
    // noGuide first so the guideline-preference tie-break (not order) must promote G.
    expect(selectStrongestAnnotation([noGuide, withGuide])?.annotationId).toBe("G");
  });

  it("an unknown/null level never outranks a real level", () => {
    const list = [ann({ evidenceLevel: null, annotationId: "NULL" }), ann({ evidenceLevel: "4", annotationId: "REAL" })];
    expect(selectStrongestAnnotation(list)?.annotationId).toBe("REAL");
  });

  it("empty list → null", () => {
    expect(selectStrongestAnnotation([])).toBeNull();
  });
});

// --- normalization of raw PharmGKB records -------------------------------------

describe("normalizeClinicalAnnotation — real PharmGKB shape", () => {
  it("maps levelOfEvidence.term, types, location, chemical, guideline", () => {
    const norm = normalizeClinicalAnnotation(
      rawRecord("1A", { types: ["Efficacy"], gene: "CYP2C19", rsid: "rs4244285", drug: "clopidogrel", guideline: "CPIC clopidogrel" })
    );
    expect(norm.evidenceLevel).toBe("1A");
    expect(norm.phenotypeCategory).toBe("efficacy");
    expect(norm.gene).toBe("CYP2C19");
    expect(norm.variant).toBe("rs4244285");
    expect(norm.drug).toBe("clopidogrel");
    expect(norm.guideline).toBe("CPIC clopidogrel");
    expect(norm.summary).toContain("CYP2C19");
  });

  it("maps 'Metabolism/PK' type → metabolism, and prefers toxicity when multiple", () => {
    expect(normalizeClinicalAnnotation(rawRecord("2A", { types: ["Metabolism/PK"] })).phenotypeCategory).toBe("metabolism");
    expect(normalizeClinicalAnnotation(rawRecord("2A", { types: ["Dosage", "Toxicity"] })).phenotypeCategory).toBe("toxicity");
  });

  it("an unrecognized evidence level normalizes to null (never coerced)", () => {
    expect(normalizeClinicalAnnotation(rawRecord("9Z")).evidenceLevel).toBeNull();
  });

  it("a malformed record degrades to nulls without throwing", () => {
    const norm = normalizeClinicalAnnotation({ garbage: true });
    expect(norm.evidenceLevel).toBeNull();
    expect(norm.gene).toBeNull();
    expect(norm.drug).toBeNull();
  });
});

// --- lookup + end-to-end over mocked fetcher -----------------------------------

describe("lookupClinicalAnnotation + verifyPgxClaim — offline via injected deps", () => {
  it("lookup parses the { data: [...] } envelope into normalized annotations", async () => {
    const deps = depsReturning({ status: "success", data: [rawRecord("1A"), rawRecord("3")] });
    const annotations = await lookupClinicalAnnotation({ drug: "clopidogrel", gene: "CYP2C19" }, deps);
    expect(annotations).toHaveLength(2);
    expect(annotations[0].evidenceLevel).toBe("1A");
  });

  it("verifyPgxClaim over a 1A mock → high_confidence with attribution + echoed claim", async () => {
    const deps = depsReturning({ data: [rawRecord("1A"), rawRecord("2A"), rawRecord("4")] });
    const r = await verifyPgxClaim(
      { drug: "clopidogrel", gene: "CYP2C19", variant: "rs4244285", claimedEffect: "reduced efficacy" },
      deps
    );
    expect(r.verdict).toBe("high_confidence");
    expect(r.strongestEvidenceLevel).toBe("1A");
    expect(r.annotations).toHaveLength(3);
    expect(r.claimedEffect).toBe("reduced efficacy");
    expect(r.attribution).toBe(PHARMGKB_ATTRIBUTION);
    expect(r.attribution).toContain("CC BY-SA 4.0");
  });

  it("upstream failure (null payload) → honest not_found, no throw", async () => {
    const deps: PharmGkbDeps = { fetchJson: async () => null };
    const r = await verifyPgxClaim({ drug: "clopidogrel", gene: "CYP2C19" }, deps);
    expect(r.verdict).toBe("not_found");
    expect(r.annotations).toHaveLength(0);
    expect(r.strongest).toBeNull();
  });

  it("empty result set → not_found", async () => {
    const deps = depsReturning({ status: "fail", data: [] });
    const r = await verifyPgxClaim({ drug: "nonexistentdrug" }, deps);
    expect(r.verdict).toBe("not_found");
  });

  it("claimedEffect NEVER changes the verdict — determined purely by evidence level", async () => {
    const deps = depsReturning({ data: [rawRecord("4")] });
    const r = await verifyPgxClaim(
      { drug: "clopidogrel", claimedEffect: "definitely high confidence per my belief" },
      deps
    );
    expect(r.verdict).toBe("preliminary");
  });
});
