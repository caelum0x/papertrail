import { z } from "zod";

// Zod schemas + shared types for the QUANTITATIVE CONTRADICTION ATLAS.
//
// When cross-source verification returns a "mixed" verdict (lib/scieval/valsci.ts:
// some sources support the claim, others refute it), the atlas routes BOTH SIDES to a
// DETERMINISTIC conflict explainer that attributes the reversal to a study-design
// dimension — population / dose / tissue / follow-up.
//
// MOAT RULES enforced here:
//   * NO LLM in the numeric / verdict / attribution path. The only learned step is a
//     per-source *candidate dimension tag* (which axis a source's design differs on);
//     that tag is then RULE-SCORED against deterministically-extracted design features +
//     INDRA belief. Claude never decides the resolution category or which dimension wins.
//   * Every quoted span is a verbatim substring of the source (grounded via
//     lib/grounding locateSpan upstream) — anything ungroundable is dropped + counted.
//   * Prefer an honest "insufficient" / "no_conflict" over a forced attribution.
//
// Two roles (mirroring lib/mechanism/schemas.ts):
//   1. Validate the raw Claude candidate-dimension tag at the LLM trust boundary.
//   2. Give the deterministic attribution + orchestration layer typed shapes so the
//      rule-scoring never defends against malformed records.

// ---------------------------------------------------------------------------
// Conflict dimensions — the closed vocabulary of study-design axes along which two
// sources can disagree about the same claim. A reversal is attributed to exactly one
// (or none, honestly). Ported from Valsci's contradiction-resolution intent + the
// standard clinical-trial design features (population, dose, tissue/assay, follow-up).
// ---------------------------------------------------------------------------

export const CONFLICT_DIMENSIONS = [
  "population",
  "dose",
  "tissue",
  "follow_up",
] as const;

export const ConflictDimensionSchema = z.enum(CONFLICT_DIMENSIONS);
export type ConflictDimension = z.infer<typeof ConflictDimensionSchema>;

// ---------------------------------------------------------------------------
// Which side of the conflict a source sits on. Derived DETERMINISTICALLY from the
// signed Valsci support score (support > 0 -> supporting, support < 0 -> refuting).
// Sources with support === 0 carry no directional weight and are excluded.
// ---------------------------------------------------------------------------

export const CONFLICT_SIDES = ["supporting", "refuting"] as const;
export const ConflictSideSchema = z.enum(CONFLICT_SIDES);
export type ConflictSide = z.infer<typeof ConflictSideSchema>;

// ---------------------------------------------------------------------------
// Resolution categories — the deterministic outcome of the atlas, ported from Valsci's
// contradiction-resolution loop (backend/engines/Valsci/papertrail_conflict.py).
//   attributed_reversal  — both sides present AND one design dimension explains the
//                           reversal (the winning dimension has grounded feature
//                           differences on both sides).
//   unattributed_conflict — both sides present but NO dimension has grounded feature
//                           differences strong enough to explain the reversal (honest:
//                           "sources conflict, but we can't attribute it").
//   no_conflict           — the sources do not actually straddle both sides (one side
//                           empty), so there is nothing to resolve.
//   insufficient          — too few grounded, directional sources to resolve at all.
// ---------------------------------------------------------------------------

export const RESOLUTION_CATEGORIES = [
  "attributed_reversal",
  "unattributed_conflict",
  "no_conflict",
  "insufficient",
] as const;

export const ResolutionCategorySchema = z.enum(RESOLUTION_CATEGORIES);
export type ResolutionCategory = z.infer<typeof ResolutionCategorySchema>;

// ---------------------------------------------------------------------------
// Raw Claude output for ONE source: the CANDIDATE dimension tag + a verbatim quote for
// each design feature the model believes the source reports. This is the ONLY learned
// step; it proposes *where to look*, never *what the answer is*. Grounding verifies each
// featureQuote as a real substring of raw_text before it is allowed to score anything.
// ---------------------------------------------------------------------------

export const RawDesignFeatureSchema = z.object({
  dimension: ConflictDimensionSchema,
  // A short normalized descriptor of the feature value the source reports on this
  // dimension (e.g. "elderly", "high dose 80mg", "hepatocytes", "12-month"). Used only
  // as a display label + deterministic same/different comparison, never as a number.
  value: z.string().trim().min(1).max(200),
  // Verbatim quote from the source that states this design feature. Grounded downstream;
  // dropped if it can't be located in raw_text.
  quote: z.string().trim().min(1).max(1000),
});
export type RawDesignFeature = z.infer<typeof RawDesignFeatureSchema>;

export const RawSourceTagSchema = z.object({
  features: z.array(RawDesignFeatureSchema).max(8),
});
export type RawSourceTag = z.infer<typeof RawSourceTagSchema>;

// ---------------------------------------------------------------------------
// A grounded design feature — its quote LOCATED verbatim in raw_text (via locateSpan).
// Ungroundable features are dropped, so a feature here always points at a real span.
// ---------------------------------------------------------------------------

export const GroundedFeatureSchema = z.object({
  dimension: ConflictDimensionSchema,
  value: z.string().min(1),
  // The verbatim source substring we located (NOT the model's paraphrase).
  quote: z.string().min(1),
  grounding: z.object({
    status: z.enum(["exact", "approximate"]),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }),
});
export type GroundedFeature = z.infer<typeof GroundedFeatureSchema>;

// ---------------------------------------------------------------------------
// A per-side grounded verdict for ONE source — reuses the Valsci grounded score plus the
// deterministic side assignment, the source's mechanism belief (INDRA), and its grounded
// design features. Everything load-bearing is grounded or deterministic.
// ---------------------------------------------------------------------------

export interface SourceVerdict {
  source_type: string;
  external_id: string;
  title: string | null;
  url: string | null;
  side: ConflictSide;
  // Signed Valsci support in [-1, 1] (deterministic aggregation upstream).
  support: number;
  // Valsci relevance in [0, 1].
  relevance: number;
  // Deterministic INDRA belief in [0, 1] for the strongest mechanism this source grounds
  // toward the claim (0 when no mechanism grounds). Weights the side, never decides it.
  mechanism_belief: number;
  // The verbatim Valsci support span (grounded upstream).
  span: {
    text: string;
    grounding: { status: "exact" | "approximate"; start: number; end: number };
  };
  // Grounded design features this source reports, per dimension.
  features: GroundedFeature[];
}

// ---------------------------------------------------------------------------
// Attribution of ONE dimension: does it explain the reversal? Fully deterministic.
// `differs` is true when BOTH sides report a feature on this dimension AND their values
// differ (case-insensitive) — the structural signature of a design-driven reversal.
// `strength` is a deterministic score in [0, 1] combining feature coverage on both sides
// with the mean mechanism belief of the sides (see atlas.ts scoreDimension). The winning
// dimension is the highest-strength dimension that `differs`.
// ---------------------------------------------------------------------------

export interface DimensionAttribution {
  dimension: ConflictDimension;
  differs: boolean;
  strength: number;
  supporting_values: string[];
  refuting_values: string[];
  // The grounded quotes backing the differing values on each side (for display).
  supporting_quotes: GroundedFeature[];
  refuting_quotes: GroundedFeature[];
}

// ---------------------------------------------------------------------------
// The full atlas result returned to callers + serialized by the API.
// ---------------------------------------------------------------------------

export interface ContradictionAtlasResult {
  claim: string;
  // Valsci claim-level verdict on the whole set — the atlas only does real work when this
  // is "mixed"; otherwise resolution_category reflects the honest non-conflict outcome.
  claim_verdict: "supported" | "mixed" | "refuted" | "insufficient";
  resolution_category: ResolutionCategory;
  // The dimension the reversal is attributed to, or null when unattributed / no conflict.
  primary_hypothesis: {
    dimension: ConflictDimension;
    statement: string;
    strength: number;
  } | null;
  supporting: SourceVerdict[];
  refuting: SourceVerdict[];
  supporting_count: number;
  refuting_count: number;
  // Deterministic per-dimension attribution table (all four dimensions, sorted by strength).
  attributions: DimensionAttribution[];
  // Honest bookkeeping — how many inputs were dropped / abstained, never hidden.
  considered_count: number;
  below_floor_count: number;
  grounding_dropped_count: number;
  feature_grounding_dropped_count: number;
}

// ---------------------------------------------------------------------------
// Public request schema for POST /api/verify/contradiction-resolve. A claim plus an
// array of sources (raw_text never logged). Mirrors the ValsciSourceInput shape so the
// atlas can reuse lib/scieval/valsci scoreClaim directly.
// ---------------------------------------------------------------------------

export const ContradictionSourceSchema = z.object({
  source_type: z.string().trim().min(1).max(64),
  external_id: z.string().trim().min(1).max(256),
  raw_text: z.string().min(40).max(40_000),
  title: z.string().max(500).nullish(),
  url: z.string().max(1000).nullish(),
});
export type ContradictionSourceInput = z.infer<typeof ContradictionSourceSchema>;

export const ContradictionResolveRequestSchema = z.object({
  claim: z.string().trim().min(10).max(2000),
  sources: z.array(ContradictionSourceSchema).min(2).max(24),
});
export type ContradictionResolveRequest = z.infer<typeof ContradictionResolveRequestSchema>;
