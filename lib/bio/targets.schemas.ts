import { z } from "zod";

// Zod schemas for the Open Targets Platform target–disease association layer.
//
// Two roles:
//   1. Validate the SHAPE of what we parse out of the Open Targets GraphQL API
//      (so a schema change upstream fails loudly here, not silently downstream).
//   2. Validate the OPTIONAL Claude plain-language summary (per CLAUDE.md, no raw
//      JSON.parse of an LLM response is trusted — it must pass a Zod schema).
//
// The numeric scores are the DETERMINISTIC values the Open Targets API returns
// verbatim. No LLM ever touches them; the summary schema is a separate, additive
// layer that can only reference the already-returned data.

// Open Targets association scores are all in [0, 1]. We keep them as-is (verbatim
// from the API) but bound-check so a malformed payload can't smuggle a nonsense
// score through. A datatype the API doesn't score for this pair is `null`, not 0 —
// we must not fabricate a zero where the API reported "no evidence of this type".
const scoreValue = z.number().min(0).max(1);

// Per-datatype breakdown of the overall association. We surface the four datatypes
// most meaningful to a translational-research audience; each is null when Open
// Targets returns no evidence of that type for this target–disease pair.
export const DatatypeScoresSchema = z.object({
  genetic_association: scoreValue.nullable(),
  known_drug: scoreValue.nullable(),
  literature: scoreValue.nullable(),
  animal_model: scoreValue.nullable(),
});
export type DatatypeScores = z.infer<typeof DatatypeScoresSchema>;

// A drug already known to act on this target for this disease (from Open Targets'
// knownDrugs aggregation). Fields are optional/nullable because the API omits some
// per row; we never fabricate a phase or mechanism the API didn't return.
export const KnownDrugSchema = z.object({
  drugId: z.string().nullable(),
  drugName: z.string().nullable(),
  mechanismOfAction: z.string().nullable(),
  // Clinical phase as reported by Open Targets (0–4). Kept as the API's number.
  phase: z.number().nullable(),
  status: z.string().nullable(),
});
export type KnownDrug = z.infer<typeof KnownDrugSchema>;

// A tractability assessment row (e.g. Small molecule / Antibody modality with a
// boolean "is this label satisfied"). Verbatim from Open Targets tractability.
export const TractabilitySchema = z.object({
  label: z.string(),
  modality: z.string(),
  value: z.boolean(),
});
export type Tractability = z.infer<typeof TractabilitySchema>;

// The resolved identifiers for a target symbol / disease name lookup. `null`
// id means "no confident match found" — an honest empty result, never a guess.
export const ResolvedTargetSchema = z.object({
  querySymbol: z.string(),
  ensemblId: z.string().nullable(),
  approvedSymbol: z.string().nullable(),
  approvedName: z.string().nullable(),
});
export type ResolvedTarget = z.infer<typeof ResolvedTargetSchema>;

export const ResolvedDiseaseSchema = z.object({
  queryName: z.string(),
  efoId: z.string().nullable(),
  name: z.string().nullable(),
});
export type ResolvedDisease = z.infer<typeof ResolvedDiseaseSchema>;

// The full target–disease evidence result. `found` distinguishes an honest
// "no association scored for this pair" from a scored association — a missing
// association is a legitimate answer, not an error.
export const TargetDiseaseEvidenceSchema = z.object({
  found: z.boolean(),
  target: ResolvedTargetSchema,
  disease: ResolvedDiseaseSchema,
  // Overall association score in [0, 1], verbatim from Open Targets; null when
  // the pair has no scored association at all.
  overallScore: scoreValue.nullable(),
  datatypeScores: DatatypeScoresSchema,
  knownDrugs: z.array(KnownDrugSchema),
  tractability: z.array(TractabilitySchema),
});
export type TargetDiseaseEvidence = z.infer<typeof TargetDiseaseEvidenceSchema>;

// The OPTIONAL Claude-generated plain-language summary. Validated before use.
// It is a description ONLY — it carries no numbers of its own; every score the
// caller shows comes from the deterministic `TargetDiseaseEvidence` above.
export const EvidenceSummarySchema = z.object({
  summary: z.string().min(1),
  // The single datatype the model judged to contribute most, echoed back so the
  // UI can highlight it. Constrained to the known datatype keys (or null) so the
  // model can't invent a category that isn't in the returned data.
  strongestDatatype: z
    .enum(["genetic_association", "known_drug", "literature", "animal_model"])
    .nullable(),
});
export type EvidenceSummary = z.infer<typeof EvidenceSummarySchema>;

// The public POST body for /api/bio/target-disease.
export const TargetDiseaseRequestSchema = z.object({
  target: z.string().trim().min(1, "target symbol is required").max(100),
  disease: z.string().trim().min(1, "disease name is required").max(200),
});
export type TargetDiseaseRequest = z.infer<typeof TargetDiseaseRequestSchema>;
