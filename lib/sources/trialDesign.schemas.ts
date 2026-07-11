import { z } from "zod";

// Zod schema for the PUBLIC /api/trials/design request body. Never trust raw JSON:
// this validates the boundary and hands the deterministic engine typed, normalized
// inputs. No LLM is involved anywhere in this feature — this is a structural schema.
//
// A request must carry AT LEAST ONE of: an `eligibility` text blob to split into
// gates, or a `design` object to score for credibility. An empty {} probe is rejected
// so the route always has something to compute.

const DesignSchema = z.object({
  randomized: z.boolean().nullish(),
  // Free-text masking descriptor from the registry (e.g. "Double (Participant, Investigator)").
  blinding: z.string().trim().max(200).nullish(),
  enrollment: z.number().finite().nullish(),
  // Phase token (e.g. "PHASE3", "PHASE1/PHASE2"); normalized deterministically downstream.
  phase: z.string().trim().max(64).nullish(),
});

export const TrialDesignRequestSchema = z
  .object({
    eligibility: z.string().max(50_000).optional(),
    design: DesignSchema.optional(),
  })
  .refine((v) => v.eligibility !== undefined || v.design !== undefined, {
    message: "Provide `eligibility` text and/or a `design` object.",
    path: ["eligibility"],
  });

export type TrialDesignRequest = z.infer<typeof TrialDesignRequestSchema>;
