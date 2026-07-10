import { z } from "zod";

// Evidence Knowledge Graph — Zod schemas for the entities and typed relations
// Claude extracts from a source's raw_text. These are the ONLY shapes allowed out
// of the extraction step: every Claude structured output is validated against
// ExtractionResultSchema before any of it is trusted (per BUILD_MINDSET rule 1).
//
// The vocabulary is deliberately small and biomedical-specific so the graph stays
// queryable and the relation types map onto the deterministic grounding layer that
// follows (rule 2): each relation must be traceable to an exact source sentence.

// The kinds of nodes we recognise in clinical-trial / biomedical text.
export const EntityType = z.enum([
  "drug", // an intervention: drug, device, procedure, therapy
  "condition", // a disease / condition / indication
  "population", // a studied population or subgroup
  "outcome", // a measured endpoint / outcome
  "trial", // a named study / trial (e.g. an NCT-identified trial)
]);
export type EntityType = z.infer<typeof EntityType>;

// The typed, directed relations we extract between entities. Kept to a closed set
// so the graph is analysable and every edge label is meaningful.
export const RelationType = z.enum([
  "treats", // drug -> condition
  "reduces_risk_of", // drug/intervention -> outcome/condition
  "increases_risk_of", // drug/intervention -> outcome/condition (harm)
  "associated_with", // entity -> entity (non-causal association)
  "contradicts", // finding -> finding / claim
  "studied_in", // drug/condition/outcome -> trial/population
  "no_effect_on", // drug/intervention -> outcome (null result)
]);
export type RelationType = z.infer<typeof RelationType>;

// A single extracted entity. `name` is the surface form; `normalized` is a
// lower-cased canonical key used to merge the same entity across sources.
export const ExtractedEntitySchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: EntityType,
});
export type ExtractedEntity = z.infer<typeof ExtractedEntitySchema>;

// A single extracted relation. `subject`/`object` reference entity NAMES (must
// match an entity in the same extraction). `evidence_sentence` is the model's
// quote of the exact source sentence supporting the relation — this is what the
// grounding layer locates verbatim in raw_text; an ungroundable relation is dropped.
export const ExtractedRelationSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  predicate: RelationType,
  object: z.string().trim().min(1).max(200),
  evidence_sentence: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .describe("The exact sentence from the source text that supports this relation."),
});
export type ExtractedRelation = z.infer<typeof ExtractedRelationSchema>;

// The full validated output of one Claude extraction pass over a source.
export const ExtractionResultSchema = z.object({
  entities: z.array(ExtractedEntitySchema).max(60),
  relations: z.array(ExtractedRelationSchema).max(80),
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

// ---------------------------------------------------------------------------
// Grounded (post-verification) shapes — what leaves lib/graph/extract.ts. Each
// relation now carries the VERBATIM located sentence plus its char offsets into
// the source raw_text, so the UI can show exactly what backs every edge.
// ---------------------------------------------------------------------------

export interface GroundedRelation {
  subject: string;
  subject_type: EntityType;
  predicate: RelationType;
  object: string;
  object_type: EntityType;
  /** Provenance: the source this relation was extracted from. */
  source_id: string;
  /** The verbatim supporting sentence located in the source raw_text. */
  grounded_sentence: string;
  grounding: {
    status: "exact" | "approximate";
    start: number;
    end: number;
  };
}

export interface SourceExtraction {
  source_id: string;
  entities: ExtractedEntity[];
  relations: GroundedRelation[];
  /** Relations Claude proposed that could not be grounded and were dropped. */
  dropped_relations: number;
}

// ---------------------------------------------------------------------------
// Aggregated graph shapes — the output of lib/graph/build.ts, consumed by the
// API and the visualisation. Pure aggregation over grounded extractions.
// ---------------------------------------------------------------------------

export interface GraphNode {
  /** Canonical id: `${type}:${normalized name}`. */
  id: string;
  label: string;
  type: EntityType;
  /** How many grounded edges touch this node (degree), for sizing in the UI. */
  degree: number;
}

export interface GraphEdgeProvenance {
  source_id: string;
  grounded_sentence: string;
  grounding: { status: "exact" | "approximate"; start: number; end: number };
}

export interface GraphEdge {
  id: string;
  source: string; // subject node id
  target: string; // object node id
  predicate: RelationType;
  /** Every source-sentence that supports this (subject, predicate, object) edge. */
  provenance: GraphEdgeProvenance[];
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
