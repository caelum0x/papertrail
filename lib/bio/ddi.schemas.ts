import { z } from "zod";

// Zod schemas for the open DRUG–DRUG-INTERACTION (DDI) signal layer.
//
// This layer derives an interaction signal purely from FAERS (openFDA, CC0)
// spontaneous-report counts. It deliberately AVOIDS DrugBank / DDInter and any
// other paid or non-commercial interaction knowledge base — everything here is
// computed from open report counts with the same disproportionality math the
// pharmacovigilance layer uses. NO LLM is anywhere in the numeric path.
//
// Two roles for these schemas:
//   1. Validate the public POST body for /api/bio/drug-interaction.
//   2. Describe (and bound-check) the shape of the deterministic result the
//      engine returns, so a malformed value can never masquerade as a signal.

// A single disproportionality block (PRR / ROR / chi² / IC) for one 2x2 table.
// These are the exact fields lib/bio/pharmacovigilance.ts computes; we re-declare
// the shape here (rather than import a value) so the schema stays self-contained
// and the numbers can be bound-checked at the trust boundary.
export const DisproportionalitySchema = z.object({
  a: z.number(),
  b: z.number(),
  c: z.number(),
  d: z.number(),
  n: z.number(),
  prr: z.number(),
  prrCiLower: z.number(),
  prrCiUpper: z.number(),
  ror: z.number(),
  rorCiLower: z.number(),
  rorCiUpper: z.number(),
  chiSquared: z.number(),
  chiSquaredYates: z.number(),
  pValue: z.number(),
  informationComponent: z.number(),
  ic025: z.number(),
  signal: z.boolean(),
});
export type DisproportionalityBlock = z.infer<typeof DisproportionalitySchema>;

// The interaction verdict. DETERMINISTIC, from documented thresholds only:
//   synergistic_signal — the co-reported (BOTH drugs) signal is materially higher
//                        than EITHER drug alone (possible interaction / synergy).
//   no_excess          — a valid combined signal exists but it does NOT exceed the
//                        single-drug signals materially (the co-report is explained
//                        by each drug's own event profile, not their combination).
//   insufficient_data  — too few co-reports to compute a trustworthy contrast.
export const InteractionVerdictSchema = z.enum([
  "synergistic_signal",
  "no_excess",
  "insufficient_data",
]);
export type InteractionVerdict = z.infer<typeof InteractionVerdictSchema>;

// The full DDI signal result. `combined` is the disproportionality of the event
// among reports listing BOTH drugs; `aAlone` / `bAlone` are the single-drug
// signals used for the interaction contrast. Any block can be null when its 2x2
// couldn't be assembled — an HONEST empty, never a fabricated table.
export const InteractionSignalSchema = z.object({
  drugA: z.string(),
  drugB: z.string(),
  event: z.string(),
  combined: DisproportionalitySchema.nullable(),
  aAlone: DisproportionalitySchema.nullable(),
  bAlone: DisproportionalitySchema.nullable(),
  interaction: InteractionVerdictSchema,
});
export type InteractionSignalResult = z.infer<typeof InteractionSignalSchema>;

// The public POST body for /api/bio/drug-interaction.
export const InteractionRequestSchema = z.object({
  drugA: z.string().trim().min(1, "drugA is required").max(200),
  drugB: z.string().trim().min(1, "drugB is required").max(200),
  event: z.string().trim().min(1, "event is required").max(200),
});
export type InteractionRequest = z.infer<typeof InteractionRequestSchema>;
