import { z } from "zod";

// Zod schemas for the ChEMBL drug-target BIOACTIVITY / MECHANISM verification feature.
//
// Data source: ChEMBL (EBI), licensed CC BY-SA 3.0 — attribution + share-alike.
// (See lib/bio/chembl.ts header for the full attribution note.) These schemas play
// two roles, mirroring genetics.schemas.ts:
//   1. Validate the PUBLIC request body at the API boundary (never trust raw JSON).
//   2. Give the deterministic verdict engine typed, normalized records so the numeric
//      potency/phase comparison never has to defend against a malformed payload.
//
// No LLM is involved anywhere in this module — these are ordinary structural schemas.

// --- Public request ------------------------------------------------------------

// A bioactivity claim is keyed by a drug (required) plus any subset of the claimed
// attributes to check: a target, a claimed potency in nanomolar, a claimed mechanism
// string, and/or a claimed clinical phase (0-4, ChEMBL's max_phase scale).
export const BioactivityRequestSchema = z.object({
  drug: z.string().trim().min(1, "drug is required").max(200),
  target: z.string().trim().min(1).max(200).optional(),
  // Claimed potency in nM. Must be positive and finite (a potency of 0 or negative
  // is not a meaningful IC50/Ki, so we reject it at the boundary).
  claimedPotencyNM: z.number().positive().finite().optional(),
  claimedMechanism: z.string().trim().min(1).max(300).optional(),
  // ChEMBL's max_phase is 0 (preclinical) .. 4 (approved). We accept the integer band.
  claimedPhase: z.number().int().min(0).max(4).optional(),
});

export type BioactivityRequest = z.infer<typeof BioactivityRequestSchema>;

// --- Normalized upstream records (what our fetchers return) --------------------

// The standard bioactivity measurement types ChEMBL reports that we treat as
// potency for comparison. Anything outside this set is ignored for the numeric
// verdict (we only compare like-for-like potency endpoints).
export const POTENCY_TYPES = ["IC50", "Ki", "Kd", "EC50"] as const;
export type PotencyType = (typeof POTENCY_TYPES)[number];
export const PotencyTypeSchema = z.enum(POTENCY_TYPES);

// A molecule resolved from a name to its ChEMBL identity. `maxPhase` is ChEMBL's
// max_phase (0-4) or null when ChEMBL doesn't report one. chemblId null means the
// name did not resolve — an honest "not found", never a fabricated id.
export const ResolvedMoleculeSchema = z.object({
  queryName: z.string(),
  chemblId: z.string().nullable(),
  prefName: z.string().nullable(),
  maxPhase: z.number().nullable(),
});

export type ResolvedMolecule = z.infer<typeof ResolvedMoleculeSchema>;

// A single bioactivity record, normalized out of the ChEMBL /activity payload.
// `standardValue` is in `standardUnits` (typically nM). `pChembl` is ChEMBL's
// -log10(molar) potency (higher = more potent) when the assay reported one.
export const BioactivitySchema = z.object({
  targetChemblId: z.string().nullable(),
  targetName: z.string().nullable(),
  standardType: PotencyTypeSchema.nullable(),
  standardValue: z.number().nullable(),
  standardUnits: z.string().nullable(),
  pChembl: z.number().nullable(),
});

export type Bioactivity = z.infer<typeof BioactivitySchema>;

// --- Verdicts ------------------------------------------------------------------

// Potency verdict vocabulary. `confirmed_within_order` = claim and measurement agree
// to within one order of magnitude; over/understated = claim is stronger/weaker than
// the measured potency by more than the band; not_found = no comparable measurement.
export const POTENCY_VERDICTS = [
  "confirmed_within_order",
  "overstated",
  "understated",
  "not_found",
] as const;
export type PotencyVerdict = (typeof POTENCY_VERDICTS)[number];
export const PotencyVerdictSchema = z.enum(POTENCY_VERDICTS);

// Phase verdict vocabulary. confirmed = claimed phase matches ChEMBL max_phase;
// overstated = claim > ChEMBL (drug isn't as far along as claimed — the dangerous
// direction); understated = claim < ChEMBL; not_found = no max_phase to compare.
export const PHASE_VERDICTS = [
  "confirmed",
  "overstated",
  "understated",
  "not_found",
] as const;
export type PhaseVerdict = (typeof PHASE_VERDICTS)[number];
export const PhaseVerdictSchema = z.enum(PHASE_VERDICTS);

// Mechanism verdict vocabulary. This is a plain deterministic string check (does the
// claimed mechanism appear among the target names / pref name), NOT an LLM judgement.
// consistent = claimed target/mechanism substring-matches a returned activity's target;
// unverified = a mechanism was claimed but nothing returned matched it; not_claimed =
// no mechanism was claimed.
export const MECHANISM_VERDICTS = ["consistent", "unverified", "not_claimed"] as const;
export type MechanismVerdict = (typeof MECHANISM_VERDICTS)[number];
export const MechanismVerdictSchema = z.enum(MECHANISM_VERDICTS);

// The potency-comparison sub-result. `measuredValueNM` is the representative measured
// potency the claim was compared against (the most-potent comparable measurement);
// `ratio` = claimed / measured (a value >>1 means the claim is more potent than
// measured, i.e. overstated). `bandOrders` is the documented order-of-magnitude
// tolerance. All numeric — no LLM.
export const PotencyComparisonSchema = z.object({
  verdict: PotencyVerdictSchema,
  claimedNM: z.number().nullable(),
  measuredNM: z.number().nullable(),
  ratio: z.number().nullable(),
  bandOrders: z.number(),
  standardType: PotencyTypeSchema.nullable(),
});

export type PotencyComparison = z.infer<typeof PotencyComparisonSchema>;

// The phase-comparison sub-result.
export const PhaseComparisonSchema = z.object({
  verdict: PhaseVerdictSchema,
  claimedPhase: z.number().nullable(),
  chemblMaxPhase: z.number().nullable(),
});

export type PhaseComparison = z.infer<typeof PhaseComparisonSchema>;

// The full result the engine returns and the route serializes. `supporting` holds
// ONLY activity records ChEMBL actually returned (never fabricated). Each of the three
// comparison arms is independent and honest-empty when the relevant claim is absent
// or the data doesn't support a comparison.
export const BioactivityVerificationSchema = z.object({
  drug: z.string(),
  molecule: ResolvedMoleculeSchema,
  target: z.string().nullable(),
  potency: PotencyComparisonSchema,
  phase: PhaseComparisonSchema,
  mechanism: z.object({
    verdict: MechanismVerdictSchema,
    claimedMechanism: z.string().nullable(),
    matchedTarget: z.string().nullable(),
  }),
  supporting: z.array(BioactivitySchema),
  rationale: z.string(),
  attribution: z.string(),
});

export type BioactivityVerification = z.infer<typeof BioactivityVerificationSchema>;
