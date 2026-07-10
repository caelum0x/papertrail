// Shared client-side types for the Knowledge Graph console. These mirror the
// server graph shapes in lib/graph/schemas.ts (kept independent so the client
// bundle never imports server-only modules).

export type EntityType = "drug" | "condition" | "population" | "outcome" | "trial";

export type RelationType =
  | "treats"
  | "reduces_risk_of"
  | "increases_risk_of"
  | "associated_with"
  | "contradicts"
  | "studied_in"
  | "no_effect_on";

export interface GraphNode {
  id: string;
  label: string;
  type: EntityType;
  degree: number;
}

export interface EdgeProvenance {
  source_id: string;
  grounded_sentence: string;
  grounding: { status: "exact" | "approximate"; start: number; end: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  predicate: RelationType;
  provenance: EdgeProvenance[];
}

export interface EvidenceGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    source_count: number;
    node_count: number;
    edge_count: number;
    grounded_relation_count: number;
    dropped_relation_count: number;
  };
}

export interface GraphApiData {
  graph: EvidenceGraph;
  failed_sources: number;
  missing_source_ids: string[];
}

// Colour per entity type — muted, print-friendly palette matching the app's ink/accent.
export const ENTITY_COLORS: Record<EntityType, string> = {
  drug: "#2F6F5E",
  condition: "#C4522A",
  population: "#5A4FCF",
  outcome: "#B8860B",
  trial: "#6B7280",
};

export const ENTITY_LABELS: Record<EntityType, string> = {
  drug: "Drug / intervention",
  condition: "Condition",
  population: "Population",
  outcome: "Outcome",
  trial: "Trial",
};

export const PREDICATE_LABELS: Record<RelationType, string> = {
  treats: "treats",
  reduces_risk_of: "reduces risk of",
  increases_risk_of: "increases risk of",
  associated_with: "associated with",
  contradicts: "contradicts",
  studied_in: "studied in",
  no_effect_on: "no effect on",
};
