// Client-side view types for the mechanism-context console. These mirror the API's
// ContextedMechanismResult (lib/mechanism/schemas.ts) as a plain, serialization-shaped
// contract — the page never trusts a raw response beyond the ApiResponse envelope.

export type Species = "human" | "mouse" | "rat" | "in-vitro";
export type AssaySystem = "in-vivo" | "in-vitro" | "cell-line";
export type ContextTagKind = "tissue" | "species" | "assay";

export interface GroundedContextTag {
  kind: ContextTagKind;
  value: string;
  quote: string;
  grounding: {
    status: "exact" | "approximate";
    start: number;
    end: number;
  };
}

export interface MechanismContext {
  tissue: string | null;
  species: Species | null;
  assay: AssaySystem | null;
  tags: GroundedContextTag[];
}

export interface GroundedEvidence {
  quote: string;
  tier: "curated_database" | "full_text" | "abstract" | "preprint";
  grounding: {
    status: "exact" | "approximate";
    start: number;
    end: number;
  };
}

export interface ContextedMechanismStatement {
  subj: string;
  relation: "activates" | "inhibits" | "phosphorylates" | "binds" | "regulates";
  obj: string;
  evidence: GroundedEvidence[];
  belief: number;
  context: MechanismContext;
  translationConfidence: number;
}

export interface ContextedMechanismResult {
  statements: ContextedMechanismStatement[];
  groundingDroppedCount: number;
  contextTagsDroppedCount: number;
  edgesUpserted: number;
  filteredHumanInVivo: boolean;
  filteredOutCount: number;
}
