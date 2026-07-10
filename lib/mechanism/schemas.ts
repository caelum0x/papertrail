import { z } from "zod";

// Zod schemas + shared types for MECHANISM-STATEMENT ASSEMBLY — a native port of
// INDRA's causal-statement model (backend/engines/indra: Statement types
// Activation/Inhibition/Phosphorylation/Complex, each carrying Evidence, combined into
// a belief score).
//
// Two roles (mirroring lib/kg/schemas.ts in this repo):
//   1. Validate the raw Claude extraction output at the LLM trust boundary — never
//      trust JSON.parse of a model response without a schema.
//   2. Give the assembly + persistence layer typed, normalized shapes so the
//      deterministic belief math and grounding never defend against malformed records.
//
// The BELIEF number here is DETERMINISTIC — computed from evidence count + per-source
// reliability (INDRA's belief-combination idea), never emitted by the model. Claude
// only proposes candidate (subj, relation, obj, quote) tuples; everything load-bearing
// (grounding, belief) is code.

// ---------------------------------------------------------------------------
// Relation vocabulary — the mechanistic causal relations we extract.
//
// A closed set ported from INDRA's core Statement types:
//   activates      <- Activation
//   inhibits       <- Inhibition
//   phosphorylates <- Phosphorylation (an AddModification)
//   binds          <- Complex (physical binding / complex formation)
//   regulates      <- RegulateActivity (direction unspecified)
// Anything outside this set is dropped at extraction rather than coerced — we never
// invent a relation the model didn't ground.
// ---------------------------------------------------------------------------

export const MECHANISM_RELATIONS = [
  "activates",
  "inhibits",
  "phosphorylates",
  "binds",
  "regulates",
] as const;

export const MechanismRelationSchema = z.enum(MECHANISM_RELATIONS);
export type MechanismRelation = z.infer<typeof MechanismRelationSchema>;

// ---------------------------------------------------------------------------
// Source tier -> reliability. INDRA assigns every knowledge source a systematic +
// random error rate; a source's per-evidence RELIABILITY is 1 minus its error rate.
// We collapse INDRA's two-parameter model into a single documented reliability per
// TIER of source (curated database > full text > abstract > preprint), so the belief
// combination below has an auditable, non-LLM input for each piece of evidence.
//
// Values are FIXED constants (not tuned, not model-derived), chosen to sit in the same
// ballpark as INDRA's `1 - (syst + rand)` for the corresponding source classes
// (curated DBs ~0.9+, reading systems ~0.65). Documented, so an auditor can re-derive
// any belief by hand.
// ---------------------------------------------------------------------------

export const SOURCE_TIERS = [
  "curated_database",
  "full_text",
  "abstract",
  "preprint",
] as const;

export const SourceTierSchema = z.enum(SOURCE_TIERS);
export type SourceTier = z.infer<typeof SourceTierSchema>;

// Per-evidence reliability for one piece of evidence from a source of this tier.
// This is the r_i in INDRA's belief combination: belief = 1 - prod(1 - r_i).
export const SOURCE_TIER_RELIABILITY: Readonly<Record<SourceTier, number>> = {
  curated_database: 0.9,
  full_text: 0.8,
  abstract: 0.65,
  preprint: 0.5,
};

// ---------------------------------------------------------------------------
// Raw Claude extraction shape. Claude proposes causal mechanistic statements; each
// carries the exact `evidenceQuote` it drew the relation from, which grounding will
// verify against the source text. No belief, no offsets — those are code's job.
// ---------------------------------------------------------------------------

export const RawMechanismStatementSchema = z.object({
  subj: z.string().trim().min(1).max(200),
  relation: MechanismRelationSchema,
  obj: z.string().trim().min(1).max(200),
  evidenceQuote: z.string().trim().min(1).max(2000),
});
export type RawMechanismStatement = z.infer<typeof RawMechanismStatementSchema>;

export const MechanismExtractionSchema = z.object({
  statements: z.array(RawMechanismStatementSchema).max(50),
});
export type MechanismExtraction = z.infer<typeof MechanismExtractionSchema>;

// ---------------------------------------------------------------------------
// Grounded evidence — one piece of support whose quote was LOCATED verbatim in the
// source text (via lib/grounding locateSpan). Ungroundable quotes are dropped, so an
// evidence object here always points at a real substring of the source.
// ---------------------------------------------------------------------------

export const GroundedEvidenceSchema = z.object({
  // The verbatim source substring we located (NOT the model's paraphrase).
  quote: z.string().min(1),
  tier: SourceTierSchema,
  grounding: z.object({
    status: z.enum(["exact", "approximate"]),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }),
});
export type GroundedEvidence = z.infer<typeof GroundedEvidenceSchema>;

// ---------------------------------------------------------------------------
// An assembled mechanism statement — de-duplicated (subj, relation, obj) triple with
// all its grounded evidence and a DETERMINISTIC belief in [0, 1]. This is what the
// assembler returns and the API serializes.
// ---------------------------------------------------------------------------

export const MechanismStatementSchema = z.object({
  subj: z.string().min(1),
  relation: MechanismRelationSchema,
  obj: z.string().min(1),
  evidence: z.array(GroundedEvidenceSchema).min(1),
  // Deterministic belief = 1 - prod(1 - reliability_i) over the grounded evidence.
  belief: z.number().min(0).max(1),
});
export type MechanismStatement = z.infer<typeof MechanismStatementSchema>;

// The result of an assembly run: the grounded, scored statements plus an honest count
// of how many candidate statements were dropped for being ungroundable, and how many
// edges were persisted to the KG.
export const MechanismAssemblyResultSchema = z.object({
  statements: z.array(MechanismStatementSchema),
  groundingDroppedCount: z.number().int().nonnegative(),
  edgesUpserted: z.number().int().nonnegative(),
});
export type MechanismAssemblyResult = z.infer<typeof MechanismAssemblyResultSchema>;

// ---------------------------------------------------------------------------
// Public request schema for POST /api/mechanism. Free-form source text, length-capped,
// never logged. `tier` optionally declares the provenance tier of the pasted text
// (defaults to `abstract` — the most conservative common case for a pasted passage).
// ---------------------------------------------------------------------------

export const MechanismRequestSchema = z.object({
  text: z.string().min(40).max(20_000),
  tier: SourceTierSchema.optional(),
});
export type MechanismRequest = z.infer<typeof MechanismRequestSchema>;
