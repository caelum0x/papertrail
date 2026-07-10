import { z } from "zod";

// Zod schemas for the VARIANT PATHOGENICITY verification feature. Two roles:
//   1. Validate the PUBLIC request body at the API boundary (never trust raw JSON).
//   2. Give the deterministic verdict engine typed, normalized records so the numeric
//      logic never has to defend against a malformed ClinVar esummary payload.
//
// No LLM is involved anywhere in this module — these are ordinary structural schemas.
// Data source: NCBI ClinVar (public domain — https://www.ncbi.nlm.nih.gov/clinvar/).

// --- Public request ------------------------------------------------------------

// A pathogenicity query is keyed by AT LEAST ONE variant identifier: an rsID, an
// HGVS expression, or a gene symbol (optionally narrowed by condition). We enforce
// "at least one identifier" with a refine so an empty probe can't fan out into an
// unbounded catalog scan.
export const VariantPathogenicityRequestSchema = z
  .object({
    rsId: z.string().trim().min(1).max(64).optional(),
    hgvs: z.string().trim().min(1).max(256).optional(),
    gene: z.string().trim().min(1).max(64).optional(),
    condition: z.string().trim().min(1).max(200).optional(),
    // The significance a claim asserts (e.g. a paper stating a variant is
    // "pathogenic"), verified against what ClinVar actually reports. Optional:
    // absent it, the engine reports the ClinVar consensus without a claim to test.
    claimedSignificance: z.string().trim().min(1).max(64).optional(),
  })
  .refine((v) => Boolean(v.rsId) || Boolean(v.hgvs) || Boolean(v.gene), {
    message: "Provide at least one of `rsId`, `hgvs`, or `gene`.",
    path: ["rsId"],
  });

export type VariantPathogenicityRequest = z.infer<
  typeof VariantPathogenicityRequestSchema
>;

// --- Field-standard classification vocabulary ---------------------------------

// The ACMG/ClinVar germline classification tiers we normalize onto. "Conflicting"
// is ClinVar's own outcome when submitters disagree ("Conflicting classifications
// of pathogenicity"); "VUS" is the variant of uncertain significance bucket. Any
// significance string we can't confidently map stays null (honest unknown), never
// forced into a tier.
export const CLINICAL_SIGNIFICANCES = [
  "Pathogenic",
  "Likely pathogenic",
  "VUS",
  "Likely benign",
  "Benign",
  "Conflicting",
] as const;

export type ClinicalSignificance = (typeof CLINICAL_SIGNIFICANCES)[number];

export const ClinicalSignificanceSchema = z.enum(CLINICAL_SIGNIFICANCES);

// --- Normalized upstream record (what the fetcher returns) ---------------------

// A single ClinVar record, normalized from an esummary result. `starRating` is the
// 0–4 ClinVar review-confidence star mapped deterministically from `reviewStatus`
// (see STAR_BY_REVIEW_STATUS). `significance` is the normalized tier, or null when
// the raw string didn't map to a known tier.
export const ClinVarVariantRecordSchema = z.object({
  variant: z.string().nullable(),
  clinicalSignificance: ClinicalSignificanceSchema.nullable(),
  rawSignificance: z.string().nullable(),
  condition: z.string().nullable(),
  reviewStatus: z.string().nullable(),
  starRating: z.number().int().min(0).max(4),
});

export type ClinVarVariantRecord = z.infer<typeof ClinVarVariantRecordSchema>;

// --- Verdict -------------------------------------------------------------------

// The deterministic verdict vocabulary for a pathogenicity CLAIM check.
//   confirmed             — ClinVar supports the claimed significance at a
//                           confident (>=1 star) review level.
//   overstated_certainty  — claim asserts (Likely) Pathogenic but the strongest
//                           ClinVar record is VUS/benign, or is pathogenic only at
//                           0 stars (no assertion criteria). The certainty of the
//                           claim exceeds what ClinVar supports.
//   conflicting           — ClinVar itself reports conflicting classifications.
//   not_found             — no ClinVar record matched (honest empty result).
export const PATHOGENICITY_VERDICTS = [
  "confirmed",
  "overstated_certainty",
  "conflicting",
  "not_found",
] as const;

export type PathogenicityVerdict = (typeof PATHOGENICITY_VERDICTS)[number];

export const PathogenicityVerdictSchema = z.enum(PATHOGENICITY_VERDICTS);

// The full result the engine returns and the route serializes. `records` holds ONLY
// records ClinVar actually returned (never fabricated); `bestRecord` is the highest
// -star supporting record that drove the verdict, for auditability.
export const PathogenicityVerificationSchema = z.object({
  verdict: PathogenicityVerdictSchema,
  query: z.object({
    rsId: z.string().nullable(),
    hgvs: z.string().nullable(),
    gene: z.string().nullable(),
    condition: z.string().nullable(),
    claimedSignificance: z.string().nullable(),
  }),
  bestRecord: ClinVarVariantRecordSchema.nullable(),
  records: z.array(ClinVarVariantRecordSchema),
  rationale: z.string(),
});

export type PathogenicityVerification = z.infer<
  typeof PathogenicityVerificationSchema
>;
