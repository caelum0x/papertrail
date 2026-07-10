import { z } from "zod";

// Zod schemas for the PHARMACOGENOMIC ANNOTATION VERIFICATION feature over
// PharmGKB / ClinPGx (https://www.pharmgkb.org). Two roles:
//   1. Validate the PUBLIC request body at the API boundary (never trust raw JSON).
//   2. Give the deterministic verdict engine typed, normalized inputs so the numeric/
//      ordinal logic never has to defend against a malformed upstream record.
//
// No LLM is involved anywhere in this module — these are ordinary structural schemas.
//
// ATTRIBUTION: PharmGKB / ClinPGx clinical-annotation data is licensed CC BY-SA 4.0
// (https://creativecommons.org/licenses/by-sa/4.0/). Any redistribution of the
// annotation content this feature returns must attribute PharmGKB/ClinPGx and be
// shared under the same license. See lib/bio/pharmgkb.ts for the fetch layer.

// --- Public request ------------------------------------------------------------

// A PGx query is keyed by a DRUG plus OPTIONALLY a gene symbol and/or a variant/allele
// (rsID or star-allele, e.g. "CYP2C19*2"). The drug is required — a pharmacogenomic
// annotation is always "gene/variant × drug"; without the drug there is nothing to
// verify. An optional `claimedEffect` free-text lets a caller state what they believe
// the annotation says; it is NOT used to decide the deterministic verdict (that comes
// purely from PharmGKB evidence levels) — it is echoed back for the caller's audit.
export const PgxRequestSchema = z.object({
  gene: z.string().trim().min(1).max(64).optional(),
  variant: z.string().trim().min(1).max(64).optional(),
  drug: z.string().trim().min(1, "drug is required").max(200),
  claimedEffect: z.string().trim().min(1).max(500).optional(),
});

export type PgxRequest = z.infer<typeof PgxRequestSchema>;

// --- Evidence levels (the documented PharmGKB standard ordering) ---------------

// PharmGKB clinical-annotation evidence levels, STRONGEST → WEAKEST. This ordering
// is the published PharmGKB standard (https://www.pharmgkb.org/page/clinAnnLevels):
//   1A — high-quality evidence + a professional guideline (CPIC/DPWG) or FDA label.
//   1B — high-quality evidence, replicated in a significant association, no guideline.
//   2A — moderate evidence in a PharmGKB Very Important Pharmacogene (VIP) variant.
//   2B — moderate evidence, not in a VIP variant.
//   3  — low evidence: a single study, or multiple studies lacking clear consensus.
//   4  — preliminary: a case report, non-significant study, or in-vitro/molecular data.
// The array order IS the strength order; index 0 is strongest. Nothing here is tuned.
export const PGX_EVIDENCE_LEVELS = ["1A", "1B", "2A", "2B", "3", "4"] as const;

export type PgxEvidenceLevel = (typeof PGX_EVIDENCE_LEVELS)[number];

export const PgxEvidenceLevelSchema = z.enum(PGX_EVIDENCE_LEVELS);

// The phenotype category a clinical annotation describes. PharmGKB tags each
// annotation with the category of drug response it concerns.
export const PGX_PHENOTYPE_CATEGORIES = [
  "efficacy",
  "toxicity",
  "dosage",
  "metabolism",
  "other",
] as const;

export type PgxPhenotypeCategory = (typeof PGX_PHENOTYPE_CATEGORIES)[number];

export const PgxPhenotypeCategorySchema = z.enum(PGX_PHENOTYPE_CATEGORIES);

// --- Normalized upstream record (what our fetcher returns) ---------------------

// A single PharmGKB clinical annotation, normalized out of the REST payload into the
// fields the verdict engine reasons over. `evidenceLevel` is null when PharmGKB
// returned a level string we don't recognize — we NEVER coerce an unknown level into
// a known one (that would fabricate strength). `summary` is verbatim PharmGKB text.
export const ClinicalAnnotationSchema = z.object({
  annotationId: z.string().nullable(),
  gene: z.string().nullable(),
  // rsID or star-allele / genotype the annotation is keyed on (PharmGKB "location").
  variant: z.string().nullable(),
  drug: z.string().nullable(),
  phenotypeCategory: PgxPhenotypeCategorySchema.nullable(),
  evidenceLevel: PgxEvidenceLevelSchema.nullable(),
  // Whether PharmGKB attaches a professional guideline (CPIC/DPWG/FDA) to this level.
  guideline: z.string().nullable(),
  // The PharmGKB-authored plain-text annotation summary, returned VERBATIM.
  summary: z.string().nullable(),
});

export type ClinicalAnnotation = z.infer<typeof ClinicalAnnotationSchema>;

// --- Verdict -------------------------------------------------------------------

// The deterministic PGx confidence vocabulary, mapped directly from the strongest
// available evidence level (see lib/bio/pharmgkb.ts verifyPgxClaim):
//   high_confidence — a level 1A or 1B annotation exists.
//   moderate        — best available is level 2A or 2B.
//   preliminary     — best available is level 3 or 4.
//   not_found       — PharmGKB returned no matching clinical annotation (honest empty).
export const PGX_VERDICTS = [
  "high_confidence",
  "moderate",
  "preliminary",
  "not_found",
] as const;

export type PgxVerdict = (typeof PGX_VERDICTS)[number];

export const PgxVerdictSchema = z.enum(PGX_VERDICTS);

// The full result the engine returns and the route serializes. `annotations` holds
// ONLY records PharmGKB actually returned (never fabricated). `strongest` is the
// single highest-evidence annotation that drove the verdict (null when not_found).
export const PgxVerificationResultSchema = z.object({
  verdict: PgxVerdictSchema,
  gene: z.string().nullable(),
  variant: z.string().nullable(),
  drug: z.string(),
  // Echoed back verbatim from the request for the caller's audit trail; it does NOT
  // influence the verdict (the verdict is a pure function of PharmGKB evidence levels).
  claimedEffect: z.string().nullable(),
  // The evidence level that produced the verdict (null when not_found).
  strongestEvidenceLevel: PgxEvidenceLevelSchema.nullable(),
  strongest: ClinicalAnnotationSchema.nullable(),
  annotations: z.array(ClinicalAnnotationSchema),
  rationale: z.string(),
  // Attribution surfaced in-band so any consumer redistributing the data knows the
  // CC BY-SA 4.0 obligation without reading the source comment.
  attribution: z.string(),
});

export type PgxVerificationResult = z.infer<typeof PgxVerificationResultSchema>;
