// Client-facing types for the Lab Notebook console. These re-export the serializable
// shapes the API returns (from lib/labNotebook/schemas — free of `pg`/server imports)
// so the components import from one place.

export type {
  StructuredExperiment,
  ProtocolStep,
  Reagent,
  Sample,
  Observation,
  Outcome,
  Entity,
  EntityType,
  LabExperimentRecord,
  LabExperimentListItem,
} from "@/lib/labNotebook/schemas";

// Deterministic reproducibility-check shapes (lib/labNotebook/reproducibility.ts) —
// re-exported here so the components import all their types from one place.
export type {
  ReproducibilityHint,
  ReproducibilityReport,
} from "@/lib/labNotebook/reproducibility";

// Response of POST /api/lab-notebook/structure — a structured record not yet saved.
export interface StructureResponse {
  structured: import("@/lib/labNotebook/schemas").StructuredExperiment;
  droppedUngrounded: number;
}
