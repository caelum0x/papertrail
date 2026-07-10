import { z } from "zod";

// Zod schemas for the genetic-association verification feature. Two roles:
//   1. Validate the PUBLIC request body at the API boundary (never trust raw JSON).
//   2. Give the deterministic verdict engine typed, normalized inputs so the numeric
//      logic never has to defend against malformed records.
//
// No LLM is involved anywhere in this module — these are ordinary structural schemas.

// --- Public request ------------------------------------------------------------

// A genetic-association query is keyed by a disease/trait plus AT LEAST ONE of a
// gene symbol or a variant (rsID). We enforce "at least one locus key" with a refine
// so an empty {disease} probe can't fan out into an unbounded catalog scan.
export const GeneticAssociationRequestSchema = z
  .object({
    gene: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .optional(),
    variant: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .optional(),
    disease: z.string().trim().min(2).max(200),
  })
  .refine((v) => Boolean(v.gene) || Boolean(v.variant), {
    message: "Provide at least one of `gene` or `variant`.",
    path: ["gene"],
  });

export type GeneticAssociationRequest = z.infer<typeof GeneticAssociationRequestSchema>;

// --- Normalized upstream records (what our fetchers return) --------------------

// A single GWAS Catalog association, already normalized out of the EBI REST HAL
// envelope into the fields the verdict engine actually reasons over. `pValue` is a
// real number (mantissa * 10^exponent reassembled) so significance thresholds apply
// directly; `null` means the study reported an association with no usable p-value.
export const GwasAssociationSchema = z.object({
  rsId: z.string().nullable(),
  gene: z.string().nullable(),
  trait: z.string().nullable(),
  pValue: z.number().nullable(),
  orBeta: z.number().nullable(),
  riskAllele: z.string().nullable(),
  study: z.string().nullable(),
});

export type GwasAssociation = z.infer<typeof GwasAssociationSchema>;

// A single ClinVar record, normalized from the NCBI esummary payload. These carry
// clinical interpretation (Pathogenic / Benign / …) rather than a p-value, so they
// feed the `clinvar_pathogenic` / `conflicting` arms of the verdict independently.
export const ClinVarRecordSchema = z.object({
  variant: z.string().nullable(),
  clinicalSignificance: z.string().nullable(),
  condition: z.string().nullable(),
  reviewStatus: z.string().nullable(),
});

export type ClinVarRecord = z.infer<typeof ClinVarRecordSchema>;

// --- Verdict -------------------------------------------------------------------

// The deterministic verdict vocabulary. Ordered here from strongest positive
// genetic evidence to no evidence; `conflicting` is the honest "the sources
// disagree" outcome, and `no_association_found` is the honest empty result.
export const GENETIC_VERDICTS = [
  "genome_wide_significant",
  "suggestive",
  "reported_not_significant",
  "clinvar_pathogenic",
  "conflicting",
  "no_association_found",
] as const;

export type GeneticVerdict = (typeof GENETIC_VERDICTS)[number];

export const GeneticVerdictSchema = z.enum(GENETIC_VERDICTS);

// The full result the engine returns and the route serializes. `supporting` holds
// ONLY records the upstream APIs actually returned (never fabricated); the numeric
// `minPValue` is the exact value that drove a significance verdict, for auditability.
export const GeneticAssociationResultSchema = z.object({
  verdict: GeneticVerdictSchema,
  disease: z.string(),
  gene: z.string().nullable(),
  variant: z.string().nullable(),
  minPValue: z.number().nullable(),
  thresholds: z.object({
    genomeWideSignificant: z.number(),
    suggestive: z.number(),
  }),
  supporting: z.object({
    gwas: z.array(GwasAssociationSchema),
    clinvar: z.array(ClinVarRecordSchema),
  }),
  rationale: z.string(),
});

export type GeneticAssociationResult = z.infer<typeof GeneticAssociationResultSchema>;
