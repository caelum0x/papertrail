// Zod schemas for the LAB NOTEBOOK COMPANION (lib/labNotebook/structure.ts).
//
// The trust contract lives here. A wet-lab scientist pastes rough bench notes; Claude
// turns them into a structured, reproducible experiment record. Every field that QUOTES
// the notes carries a `source_span` — and PaperTrail's grounding invariant (enforced in
// structure.ts via locateSpan) guarantees that span is a VERBATIM substring of the raw
// notes. An item whose span can't be located is dropped, never shown as if sourced.
//
// All Claude output is validated against StructuredExperimentSchema (via callClaudeForJson)
// before use — never trust raw JSON.parse of a model response.

import { z } from "zod";

// A verbatim quote from the raw notes. After the Claude call, structure.ts runs
// locateSpan(rawNotes, source_span) on every field carrying one; an ungroundable span
// gets its item dropped (counted in droppedUngrounded). Nullable where the model may
// legitimately have nothing to quote for an inferred/normalized field.
// Capped generously (not at ~1000) so a legitimately long protocol step or detailed
// observation quote is not rejected by validation before grounding can even run —
// locateSpan is what actually enforces the span is a verbatim substring of the notes.
const SourceSpanSchema = z.string().trim().min(1).max(5000);

// ---------------------------------------------------------------------------
// GROUNDED SUB-SHAPES — each quotes the notes and MUST carry a source_span.
// ---------------------------------------------------------------------------

export const ReagentSchema = z.object({
  name: z.string().trim().min(1).max(300),
  vendor: z.string().trim().max(200).nullable().default(null),
  catalog: z.string().trim().max(200).nullable().default(null),
  amount: z.string().trim().max(200).nullable().default(null),
  source_span: SourceSpanSchema,
});
export type Reagent = z.infer<typeof ReagentSchema>;

export const ProtocolStepSchema = z.object({
  order: z.number().int().min(1).max(500),
  text: z.string().trim().min(1).max(2000),
  source_span: SourceSpanSchema,
});
export type ProtocolStep = z.infer<typeof ProtocolStepSchema>;

// Sample, Observation and Outcome share the same {text, source_span} shape, but stay
// as distinct named schemas/types so the record is self-documenting and each can evolve.
export const SampleSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  source_span: SourceSpanSchema,
});
export type Sample = z.infer<typeof SampleSchema>;

export const ObservationSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  source_span: SourceSpanSchema,
});
export type Observation = z.infer<typeof ObservationSchema>;

export const OutcomeSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  source_span: SourceSpanSchema,
});
export type Outcome = z.infer<typeof OutcomeSchema>;

// ---------------------------------------------------------------------------
// ENTITIES — normalized/auto-tagged bio entities the notes mention. These are a
// normalization of what the notes reference (gene/protein/cell line/etc), so they do
// NOT carry a source_span: the model may canonicalise a name the scientist abbreviated.
// ---------------------------------------------------------------------------

export const EntityTypeSchema = z.enum([
  "gene",
  "protein",
  "cell_line",
  "reagent",
  "organism",
  "method",
  "other",
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const EntitySchema = z.object({
  type: EntityTypeSchema,
  name: z.string().trim().min(1).max(300),
});
export type Entity = z.infer<typeof EntitySchema>;

// ---------------------------------------------------------------------------
// The full structured experiment record Claude must produce. Bounded arrays so a
// runaway generation can't produce an unusable wall of text — bench notes are short.
// `objective`, `equipment`, `next_steps` and `entities` are model-normalized summaries
// (no per-item span); the grounded arrays above carry the verbatim quotes.
// ---------------------------------------------------------------------------

export const StructuredExperimentSchema = z.object({
  objective: z.string().trim().max(2000).default(""),
  protocol_steps: z.array(ProtocolStepSchema).max(100).default([]),
  reagents: z.array(ReagentSchema).max(100).default([]),
  samples: z.array(SampleSchema).max(100).default([]),
  equipment: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
  observations: z.array(ObservationSchema).max(100).default([]),
  outcomes: z.array(OutcomeSchema).max(100).default([]),
  next_steps: z.array(z.string().trim().min(1).max(1000)).max(50).default([]),
  entities: z.array(EntitySchema).max(200).default([]),
  suggested_title: z.string().trim().min(1).max(300),
  suggested_date: z.string().trim().max(50).nullable().default(null),
});
export type StructuredExperiment = z.infer<typeof StructuredExperimentSchema>;

// ---------------------------------------------------------------------------
// API INPUT schemas.
// ---------------------------------------------------------------------------

// POST /api/lab-notebook/structure — the raw notes to structure (not yet saved).
export const StructureInputSchema = z.object({
  notes: z.string().trim().min(1).max(20000),
});
export type StructureInput = z.infer<typeof StructureInputSchema>;

// POST /api/lab-notebook — persist a reviewed record. `structured` is re-validated
// against StructuredExperimentSchema so a client can never save a malformed payload.
export const CreateExperimentInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  experiment_date: z.string().trim().max(50).nullable().optional(),
  raw_notes: z.string().trim().min(1).max(20000),
  structured: StructuredExperimentSchema,
  tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
});
export type CreateExperimentInput = z.infer<typeof CreateExperimentInputSchema>;

// ---------------------------------------------------------------------------
// ROW / LIST-ITEM shapes returned by the repository + API. Serializable (no `pg`
// types) so client components can import them safely. Timestamps are ISO strings.
// ---------------------------------------------------------------------------

export interface LabExperimentRecord {
  id: string;
  orgId: string;
  createdBy: string | null;
  title: string;
  experimentDate: string | null;
  rawNotes: string;
  structured: StructuredExperiment;
  tags: string[];
  createdAt: string;
}

// A lighter shape for the list view — no rawNotes / structured payload, plus a few
// roll-up counts so cards can summarise an experiment without loading everything.
export interface LabExperimentListItem {
  id: string;
  title: string;
  experimentDate: string | null;
  tags: string[];
  createdAt: string;
  stepCount: number;
  reagentCount: number;
  outcomeCount: number;
}
