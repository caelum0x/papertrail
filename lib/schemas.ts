import { z } from "zod";

// Structured finding extracted from a primary source. Every field is required
// so the model can't silently omit something it should have checked for.
export const ExtractedFindingSchema = z.object({
  effect_size: z.string().describe("The quantitative effect reported, verbatim or closely paraphrased, e.g. '30% relative risk reduction'. Use 'not reported' if absent."),
  population: z.string().describe("The specific population/subgroup studied, e.g. 'adults 65+ with prior MI'."),
  condition: z.string().describe("The disease/condition under study."),
  endpoint: z.string().describe("The primary endpoint measured, e.g. 'major adverse cardiovascular events at 24 months'."),
  caveats: z.array(z.string()).describe("Any limitations, subgroup restrictions, or qualifications stated in the source."),
});
export type ExtractedFinding = z.infer<typeof ExtractedFindingSchema>;

export const DiscrepancyType = z.enum([
  "accurate",
  "magnitude_overstated",
  "population_overgeneralized",
  "caveat_dropped",
  "no_support_found",
]);

export const FlaggedSpanSchema = z.object({
  claim_span: z.string().describe("The exact substring of the claim being flagged."),
  source_span: z.string().describe("The exact substring of the source text that contradicts or fails to support the claim span."),
  issue: z.string().describe("One-sentence explanation of the discrepancy."),
});
export type FlaggedSpan = z.infer<typeof FlaggedSpanSchema>;

// How the OTHER retrieved sources relate to the best match — the cross-verification
// signal that distinguishes a claim resting on one study from one corroborated by several.
export const CrossSourceAgreement = z.enum([
  "single_source", // only one confident source was found
  "corroborated", // other retrieved sources agree with the best match
  "conflicting", // other retrieved sources disagree with the best match
]);
export type CrossSourceAgreement = z.infer<typeof CrossSourceAgreement>;

export const VerificationResultSchema = z.object({
  discrepancy_type: DiscrepancyType,
  trust_score: z.number().int().min(0).max(100),
  explanation: z.string().describe("A 1-3 sentence plain-language summary of the verdict."),
  flagged_spans: z.array(FlaggedSpanSchema),
  cross_source_agreement: CrossSourceAgreement.describe(
    "Whether the other retrieved sources corroborate, conflict with, or are absent for the best match."
  ),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export const SourceCandidateSchema = z.object({
  id: z.string(),
  source_type: z.enum(["pubmed", "clinicaltrials"]),
  external_id: z.string(),
  title: z.string().nullable(),
  raw_text: z.string(),
  url: z.string(),
  similarity: z.number(),
  // Trial context (ClinicalTrials.gov only; null for PubMed records).
  phase: z.string().nullable().optional(),
  enrollment_count: z.number().nullable().optional(),
  // Registered outcome analyses (jsonb array of TrialResultAnalysis); null when absent.
  registered_results: z.array(z.unknown()).nullable().optional(),
});
export type SourceCandidate = z.infer<typeof SourceCandidateSchema>;
