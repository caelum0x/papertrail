import { z } from "zod";

// Boundary validation for the eval-sets / eval-runs APIs. Never trust request
// bodies or query strings — parse them through these schemas before use.

// The five discrepancy verdicts the verification pipeline can produce. Kept
// local (rather than imported from lib/schemas) so this module owns its contract
// and stays decoupled from the pipeline's internal Zod schema.
export const DISCREPANCY_TYPES = [
  "accurate",
  "magnitude_overstated",
  "population_overgeneralized",
  "caveat_dropped",
  "no_support_found",
] as const;

export const discrepancyTypeSchema = z.enum(DISCREPANCY_TYPES);
export type DiscrepancyType = z.infer<typeof discrepancyTypeSchema>;

// Body for POST /api/eval-sets — create a labeled eval set.
export const createEvalSetSchema = z.object({
  name: z.string().trim().min(1, "name is required.").max(200, "name is too long."),
  description: z.string().trim().max(2000, "description is too long.").optional(),
});
export type CreateEvalSetInput = z.infer<typeof createEvalSetSchema>;

// One labeled case. expected_substrings should appear within the flagged source
// spans the pipeline returns (used to score span grounding).
export const createEvalCaseSchema = z.object({
  claim: z
    .string()
    .trim()
    .min(10, "claim must be at least 10 characters.")
    .max(2000, "claim is too long (max 2000 characters)."),
  source_external_id: z
    .string()
    .trim()
    .max(120, "source_external_id is too long.")
    .optional(),
  expected_discrepancy_type: discrepancyTypeSchema,
  expected_substrings: z
    .array(z.string().trim().min(1).max(1000))
    .max(20, "too many expected substrings (max 20).")
    .optional(),
});
export type CreateEvalCaseInput = z.infer<typeof createEvalCaseSchema>;

// Body for POST /api/eval-runs — run an eval set through the pipeline.
export const createEvalRunSchema = z.object({
  eval_set_id: z.string().uuid("eval_set_id must be a valid uuid."),
});
export type CreateEvalRunInput = z.infer<typeof createEvalRunSchema>;
