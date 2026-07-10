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

// Response of POST /api/lab-notebook/structure — a structured record not yet saved.
export interface StructureResponse {
  structured: import("@/lib/labNotebook/schemas").StructuredExperiment;
  droppedUngrounded: number;
}
