// Client-side mirror of the /api/extraction/paper response shape. Kept in sync
// with lib/extraction/schemas.ts (PaperExtractResult). Client components import
// from here so the page stays free of engine imports.

export type GroundingStatus = "exact" | "approximate";

export interface Grounding {
  status: GroundingStatus;
  start: number;
  end: number;
}

export interface Pico {
  population: string;
  intervention: string;
  comparator: string;
  outcomes: string[];
}

export type EndpointRole = "primary" | "secondary" | "safety" | "other";

export interface Endpoint {
  name: string;
  role: EndpointRole;
  timepoint: string;
}

export type EffectMeasure = "RR" | "HR" | "OR" | "RRR" | "absolute" | "unknown";
export type EffectReconciliation = "confirmed" | "mismatch" | "unverified";

export interface GroundedEffect {
  endpoint: string;
  measure: EffectMeasure;
  claimed_point: number | null;
  claimed_ci_low: number | null;
  claimed_ci_high: number | null;
  is_percent: boolean;
  quote: string;
  grounding: Grounding;
  reconciliation: EffectReconciliation;
  parsed_point: number | null;
  note: string;
}

export interface PaperExtractResult {
  pico: Pico;
  endpoints: Endpoint[];
  effects: GroundedEffect[];
  ungrounded_dropped_count: number;
  total_effects_extracted: number;
  source: {
    id: string | null;
    title: string | null;
    external_id: string | null;
    source_type: string | null;
    url: string | null;
  };
}
