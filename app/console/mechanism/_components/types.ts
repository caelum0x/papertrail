// Client-side view types for the mechanism-assembly console page. These mirror the
// serialized shape the /api/mechanism route returns (lib/mechanism/schemas), kept in
// this vertical's own directory so the page has no cross-import into lib.

export type MechanismRelation =
  | "activates"
  | "inhibits"
  | "phosphorylates"
  | "binds"
  | "regulates";

export type SourceTier = "curated_database" | "full_text" | "abstract" | "preprint";

export interface GroundedEvidenceView {
  quote: string;
  tier: SourceTier;
  grounding: {
    status: "exact" | "approximate";
    start: number;
    end: number;
  };
}

export interface MechanismStatementView {
  subj: string;
  relation: MechanismRelation;
  obj: string;
  evidence: GroundedEvidenceView[];
  belief: number;
}

export interface MechanismAssemblyData {
  statements: MechanismStatementView[];
  groundingDroppedCount: number;
  edgesUpserted: number;
}
