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

// ===========================================================================
// CONTEXT-AWARE MECHANISM EXTRACTION (lib/mechanism/context.ts)
//
// A native port of INDRA's RefContext / BioContext idea
// (backend/engines/indra/indra/statements/context.py): every mechanism edge can carry
// the biological CONTEXT it was observed in — tissue (UBERON-ish), species (NCBI-taxon),
// assay/system (OBI-ish). Claude only PROPOSES candidate tags with a verbatim quote; the
// quote is grounded (locateSpan) and the final normalized bucket + translation-confidence
// score are decided by DETERMINISTIC code below. No LLM number is load-bearing.
// ===========================================================================

// ---------------------------------------------------------------------------
// Normalized species vocabulary (NCBI-taxon-ish). `in-vitro` is a first-class species
// bucket here because cell-line / reconstituted systems have no organism-level species
// but still describe a system whose translatability differs sharply from an organism.
// ---------------------------------------------------------------------------

export const SPECIES = ["human", "mouse", "rat", "in-vitro"] as const;
export const SpeciesSchema = z.enum(SPECIES);
export type Species = z.infer<typeof SpeciesSchema>;

// Per-species translation factor: how well a mechanism observed in this species supports
// extrapolation to human biology. FIXED constants (not tuned, not model-derived), so an
// auditor can re-derive any translation-confidence score by hand. `unknown` is the
// conservative fallback when species couldn't be grounded.
export const SPECIES_CONFIDENCE: Readonly<Record<Species | "unknown", number>> = {
  human: 1.0,
  rat: 0.6,
  mouse: 0.6,
  "in-vitro": 0.3,
  unknown: 0.2,
};

// ---------------------------------------------------------------------------
// Normalized assay/system vocabulary (OBI-ish). in-vivo > cell-line ≈ in-vitro for
// translatability; cell-line is a specific in-vitro subtype we keep distinct.
// ---------------------------------------------------------------------------

export const ASSAY_SYSTEMS = ["in-vivo", "in-vitro", "cell-line"] as const;
export const AssaySystemSchema = z.enum(ASSAY_SYSTEMS);
export type AssaySystem = z.infer<typeof AssaySystemSchema>;

// Per-assay translation factor. in-vivo evidence extrapolates far better than a dish.
export const ASSAY_CONFIDENCE: Readonly<Record<AssaySystem | "unknown", number>> = {
  "in-vivo": 1.0,
  "cell-line": 0.5,
  "in-vitro": 0.4,
  unknown: 0.3,
};

// ---------------------------------------------------------------------------
// Context tag kinds. Each candidate tag Claude proposes is one of these three, with a
// verbatim quote we must ground before trusting it.
// ---------------------------------------------------------------------------

export const CONTEXT_TAG_KINDS = ["tissue", "species", "assay"] as const;
export const ContextTagKindSchema = z.enum(CONTEXT_TAG_KINDS);
export type ContextTagKind = z.infer<typeof ContextTagKindSchema>;

// Raw Claude context-tag candidate: which statement it annotates, the kind, the surface
// term it read, and the exact quote it read it from. No normalized bucket, no offsets —
// those are code's job (classify + locateSpan).
export const RawContextTagSchema = z.object({
  statementIndex: z.number().int().nonnegative(),
  kind: ContextTagKindSchema,
  value: z.string().trim().min(1).max(200),
  evidenceQuote: z.string().trim().min(1).max(2000),
});
export type RawContextTag = z.infer<typeof RawContextTagSchema>;

export const ContextTaggingSchema = z.object({
  tags: z.array(RawContextTagSchema).max(200),
});
export type ContextTagging = z.infer<typeof ContextTaggingSchema>;

// ---------------------------------------------------------------------------
// A grounded context tag — its quote was LOCATED verbatim in the source (via locateSpan).
// Ungroundable tags are dropped, so a tag here always points at a real source substring.
// ---------------------------------------------------------------------------

export const GroundedContextTagSchema = z.object({
  kind: ContextTagKindSchema,
  // The short surface term the model read (kept for display; the normalized bucket lives
  // on the resolved MechanismContext, decided by deterministic code).
  value: z.string().min(1),
  // The verbatim source substring we located (NOT the model's paraphrase).
  quote: z.string().min(1),
  grounding: z.object({
    status: z.enum(["exact", "approximate"]),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }),
});
export type GroundedContextTag = z.infer<typeof GroundedContextTagSchema>;

// ---------------------------------------------------------------------------
// The resolved biological context of a mechanism. tissue is a free-text UBERON-ish
// surface term; species + assay are normalized buckets (or null when ungroundable —
// honest "unknown" over a forced bucket). `tags` carries the grounded evidence trail.
// ---------------------------------------------------------------------------

export const MechanismContextSchema = z.object({
  tissue: z.string().min(1).nullable(),
  species: SpeciesSchema.nullable(),
  assay: AssaySystemSchema.nullable(),
  tags: z.array(GroundedContextTagSchema),
});
export type MechanismContext = z.infer<typeof MechanismContextSchema>;

// ---------------------------------------------------------------------------
// A mechanism statement enriched with its resolved context + a DETERMINISTIC
// translation-confidence score in [0, 1] (human in-vivo > animal in-vivo > in-vitro).
// ---------------------------------------------------------------------------

export const ContextedMechanismStatementSchema = MechanismStatementSchema.extend({
  context: MechanismContextSchema,
  translationConfidence: z.number().min(0).max(1),
});
export type ContextedMechanismStatement = z.infer<typeof ContextedMechanismStatementSchema>;

// The result of a context-aware run: contexted statements plus honest drop counts and
// the filter outcome. `contextTagsDroppedCount` counts ungroundable/unusable context
// tags; `filteredOutCount` counts statements removed by the human-in-vivo filter.
export const ContextedMechanismResultSchema = z.object({
  statements: z.array(ContextedMechanismStatementSchema),
  groundingDroppedCount: z.number().int().nonnegative(),
  contextTagsDroppedCount: z.number().int().nonnegative(),
  edgesUpserted: z.number().int().nonnegative(),
  filteredHumanInVivo: z.boolean(),
  filteredOutCount: z.number().int().nonnegative(),
});
export type ContextedMechanismResult = z.infer<typeof ContextedMechanismResultSchema>;

// ---------------------------------------------------------------------------
// Public request schema for POST /api/mechanism/context-filter. Same free-form,
// length-capped, never-logged source text as /api/mechanism, plus an optional filter
// toggle to keep only human in-vivo mechanisms.
// ---------------------------------------------------------------------------

export const MechanismContextRequestSchema = z.object({
  text: z.string().min(40).max(20_000),
  tier: SourceTierSchema.optional(),
  require_human_in_vivo: z.boolean().optional(),
});
export type MechanismContextRequest = z.infer<typeof MechanismContextRequestSchema>;
