import { z } from "zod";

// Zod schemas for the BIOMARKER VALIDATION EVIDENCE layer.
//
// This module assembles the evidence for a claimed biomarker<->disease (or
// biomarker<->drug-response) relationship out of the deterministic bio engines
// PaperTrail already built:
//   - genetic association (GWAS Catalog + ClinVar, via verifyGeneticAssociation)
//   - target-disease genetic score (Open Targets, when the biomarker is a gene)
//   - literature grounding (PubTator co-mention of biomarker + disease)
//   - pharmacogenomic context (PharmGKB, when a drug is provided)
//
// The `validationLevel` is a PURE, documented function of the component strengths —
// NO LLM is anywhere in the numeric/decision path (PaperTrail moat). The OPTIONAL
// Claude summary is a separate, additive prose layer that can only describe the
// already-assembled evidence and is validated against BiomarkerSummarySchema.
//
// Roles:
//   1. Validate the SHAPE of each assembled component so a malformed signal can't
//      smuggle a nonsense value into the deterministic validationLevel.
//   2. Validate the OPTIONAL Claude plain-language summary (CLAUDE.md: never trust a
//      raw JSON.parse of an LLM response).
//
// Data-source attribution (respect licenses):
//   - EBI GWAS Catalog + NCBI ClinVar (public) — genetic association.
//   - Open Targets Platform (CC0) — target-disease genetic association score.
//   - NCBI PubTator3 (public) — normalized entity co-mention (literature grounding).
//   - PharmGKB / ClinPGx (CC BY-SA 4.0) — pharmacogenomic clinical annotation.
//     Attribution + share-alike required on redistribution of returned annotation text.

// --- Public request ------------------------------------------------------------

// A biomarker-validation query is keyed by a BIOMARKER (a gene symbol, variant/rsID,
// or protein) plus a DISEASE, and OPTIONALLY a drug for drug-response context. The
// biomarker string is passed to the underlying engines as both a gene and a variant
// key (each engine ignores what it can't use), so a caller need not pre-classify it.
export const BiomarkerRequestSchema = z.object({
  biomarker: z.string().trim().min(1, "biomarker is required").max(100),
  disease: z.string().trim().min(2, "disease is required").max(200),
  drug: z.string().trim().min(1).max(200).optional(),
});
export type BiomarkerRequest = z.infer<typeof BiomarkerRequestSchema>;

// --- Component: genetic evidence (GWAS Catalog + ClinVar) ----------------------

// The genetic-association verdict from verifyGeneticAssociation, echoed into the
// biomarker bundle. `verdict` is the exact deterministic genetic verdict; `minPValue`
// is the driving p-value (null when no disease-matched significant hit). We surface
// the verdict + strength band rather than re-deriving anything.
export const BIOMARKER_GENETIC_STRENGTHS = [
  "genome_wide", // genome_wide_significant GWAS hit
  "suggestive", // suggestive GWAS hit
  "clinvar_pathogenic", // ClinVar (Likely) Pathogenic, no significant GWAS
  "conflicting", // ClinVar reports both pathogenic and benign
  "reported", // reported association, not significant
  "none", // no disease-matched genetic evidence
] as const;
export const BiomarkerGeneticStrengthSchema = z.enum(BIOMARKER_GENETIC_STRENGTHS);
export type BiomarkerGeneticStrength =
  (typeof BIOMARKER_GENETIC_STRENGTHS)[number];

export const GeneticEvidenceSchema = z.object({
  // Whether the genetic engine actually ran (a biomarker key was usable).
  assessed: z.boolean(),
  // The raw deterministic genetic verdict string (verbatim from the genetics engine).
  verdict: z.string().nullable(),
  // The strength band we map that verdict onto for the composite decision.
  strength: BiomarkerGeneticStrengthSchema,
  // The exact p-value that drove a significance verdict (null otherwise) — auditable.
  minPValue: z.number().nullable(),
});
export type GeneticEvidence = z.infer<typeof GeneticEvidenceSchema>;

// --- Component: target-disease genetic score (Open Targets) --------------------

// Only meaningful when the biomarker resolves to a gene target. `geneticScore` is the
// Open Targets genetic_association datatype score in [0,1], verbatim; null when Open
// Targets has no genetic evidence for the pair (never a fabricated 0).
export const TargetScoreEvidenceSchema = z.object({
  // Whether the Open Targets lookup fired (biomarker treated as a gene target).
  assessed: z.boolean(),
  // Whether Open Targets returned a scored association for target<->disease.
  associationFound: z.boolean(),
  overallScore: z.number().min(0).max(1).nullable(),
  geneticScore: z.number().min(0).max(1).nullable(),
});
export type TargetScoreEvidence = z.infer<typeof TargetScoreEvidenceSchema>;

// --- Component: literature grounding (PubTator co-mention) ---------------------

// Did PubTator normalize BOTH the biomarker (as a gene/variant/protein entity) AND
// the disease in the same submitted text? Co-mention of both normalized entities is
// the deterministic literature-grounding signal. Counts are verbatim from PubTator.
export const LITERATURE_STRENGTHS = ["co_mention", "partial", "none"] as const;
export const LiteratureStrengthSchema = z.enum(LITERATURE_STRENGTHS);
export type LiteratureStrength = (typeof LITERATURE_STRENGTHS)[number];

export const LiteratureEvidenceSchema = z.object({
  // Whether the annotation call ran and returned parseable entities.
  assessed: z.boolean(),
  // PubTator resolved the biomarker as a normalized entity in the text.
  biomarkerGrounded: z.boolean(),
  // PubTator resolved the disease as a normalized entity in the text.
  diseaseGrounded: z.boolean(),
  // Both grounded (co_mention) | one grounded (partial) | neither (none).
  strength: LiteratureStrengthSchema,
});
export type LiteratureEvidence = z.infer<typeof LiteratureEvidenceSchema>;

// --- Component: pharmacogenomic context (PharmGKB) -----------------------------

// Only assembled when a drug is provided. Carries the deterministic PGx verdict +
// strongest evidence level from verifyPgxClaim, for biomarker<->drug-response context.
export const PharmacogenomicEvidenceSchema = z.object({
  // Whether a drug was provided and the PGx lookup ran.
  assessed: z.boolean(),
  // The deterministic PGx verdict (verbatim); null when not assessed.
  verdict: z.string().nullable(),
  // The strongest PharmGKB evidence level found (1A..4), null when none/ not assessed.
  strongestEvidenceLevel: z.string().nullable(),
  // CC BY-SA 4.0 attribution surfaced in-band when PGx annotation text is present.
  attribution: z.string().nullable(),
});
export type PharmacogenomicEvidence = z.infer<
  typeof PharmacogenomicEvidenceSchema
>;

// --- Assembled evidence bundle -------------------------------------------------

export const BiomarkerEvidenceSchema = z.object({
  genetic: GeneticEvidenceSchema,
  targetScore: TargetScoreEvidenceSchema,
  literature: LiteratureEvidenceSchema,
  pharmacogenomic: PharmacogenomicEvidenceSchema,
});
export type BiomarkerEvidence = z.infer<typeof BiomarkerEvidenceSchema>;

// --- Deterministic validation level --------------------------------------------

// The deterministic biomarker-validation vocabulary, STRONGEST -> WEAKEST:
//   analytically_grounded — genome-wide/ClinVar-pathogenic genetic support (OR a high
//                           Open Targets genetic score) CORROBORATED by literature
//                           co-mention. The relationship is grounded in field-standard
//                           genetic evidence and independently mentioned in the literature.
//   emerging              — real but not fully corroborated: a significant/suggestive
//                           genetic signal without literature co-mention, OR literature
//                           co-mention plus a suggestive (not genome-wide) genetic signal,
//                           OR a strong PGx drug-response annotation.
//   weak                  — only a soft signal: literature co-mention alone, a reported-
//                           but-not-significant genetic association, or a conflicting
//                           ClinVar picture — some smoke, no fire.
//   unsupported           — no disease-matched genetic, target, literature, or PGx
//                           evidence assembled (honest empty).
export const BIOMARKER_VALIDATION_LEVELS = [
  "analytically_grounded",
  "emerging",
  "weak",
  "unsupported",
] as const;
export const BiomarkerValidationLevelSchema = z.enum(
  BIOMARKER_VALIDATION_LEVELS
);
export type BiomarkerValidationLevel =
  (typeof BIOMARKER_VALIDATION_LEVELS)[number];

export const BiomarkerValidationSchema = z.object({
  biomarker: z.string(),
  disease: z.string(),
  drug: z.string().nullable(),
  evidence: BiomarkerEvidenceSchema,
  // Deterministic validation level from the documented component-strength rules.
  validationLevel: BiomarkerValidationLevelSchema,
  // Human-readable, deterministic explanation of what drove the level.
  rationale: z.string().min(1),
});
export type BiomarkerValidation = z.infer<typeof BiomarkerValidationSchema>;

// The OPTIONAL Claude-generated prose summary. Validated before use. It describes
// ONLY the assembled evidence; it carries no verdict of its own — the validationLevel
// the caller shows always comes from the deterministic BiomarkerValidation above.
export const BiomarkerSummarySchema = z.object({
  summary: z.string().min(1),
  // The single component the model judged most decisive, echoed back for the UI.
  // Constrained so the model can't invent a driver outside the assembled evidence.
  keyEvidence: z
    .enum(["genetic", "target_score", "literature", "pharmacogenomic"])
    .nullable(),
});
export type BiomarkerSummary = z.infer<typeof BiomarkerSummarySchema>;
