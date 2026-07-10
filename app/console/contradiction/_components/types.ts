// Client-side view types for the Contradiction Atlas console. These mirror the
// serialised shape of lib/contradiction/schemas.ContradictionAtlasResult returned by
// /api/verify/contradiction-resolve inside the standard { success, data, error } envelope.

export type ConflictDimension = "population" | "dose" | "tissue" | "follow_up";
export type ConflictSide = "supporting" | "refuting";

export type ResolutionCategory =
  | "attributed_reversal"
  | "unattributed_conflict"
  | "no_conflict"
  | "insufficient";

export interface GroundedFeature {
  dimension: ConflictDimension;
  value: string;
  quote: string;
  grounding: { status: "exact" | "approximate"; start: number; end: number };
}

export interface SourceVerdict {
  source_type: string;
  external_id: string;
  title: string | null;
  url: string | null;
  side: ConflictSide;
  support: number;
  relevance: number;
  mechanism_belief: number;
  span: {
    text: string;
    grounding: { status: "exact" | "approximate"; start: number; end: number };
  };
  features: GroundedFeature[];
}

export interface DimensionAttribution {
  dimension: ConflictDimension;
  differs: boolean;
  strength: number;
  supporting_values: string[];
  refuting_values: string[];
  supporting_quotes: GroundedFeature[];
  refuting_quotes: GroundedFeature[];
}

export interface ContradictionAtlasResponse {
  claim: string;
  claim_verdict: "supported" | "mixed" | "refuted" | "insufficient";
  resolution_category: ResolutionCategory;
  primary_hypothesis: {
    dimension: ConflictDimension;
    statement: string;
    strength: number;
  } | null;
  supporting: SourceVerdict[];
  refuting: SourceVerdict[];
  supporting_count: number;
  refuting_count: number;
  attributions: DimensionAttribution[];
  considered_count: number;
  below_floor_count: number;
  grounding_dropped_count: number;
  feature_grounding_dropped_count: number;
}

// One source in the request payload the console builds.
export interface SourceDraft {
  source_type: string;
  external_id: string;
  title: string;
  url: string;
  raw_text: string;
}

export const DIMENSION_LABELS: Record<ConflictDimension, string> = {
  population: "Population",
  dose: "Dose / exposure",
  tissue: "Tissue / assay",
  follow_up: "Follow-up",
};

export const RESOLUTION_LABELS: Record<ResolutionCategory, string> = {
  attributed_reversal: "Attributed reversal",
  unattributed_conflict: "Unattributed conflict",
  no_conflict: "No conflict",
  insufficient: "Insufficient evidence",
};
