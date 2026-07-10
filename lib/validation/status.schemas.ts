import { z } from "zod";

// Boundary validation for the validation-status API. Never trust request bodies:
// parse them through these schemas first. Engine keys and source names are free
// lowercase-ish slugs (the caller's engine registry decides the vocabulary), so
// we validate shape and bounds rather than an enum.

export const VALIDATION_STATUSES = [
  "complete",
  "partial",
  "insufficient",
] as const;

export type ValidationStatusLevel = (typeof VALIDATION_STATUSES)[number];

const engineKey = z.string().min(1).max(120);

// POST body: report which engines ran, which required engines were expected, and
// which sources were reachable. All arrays are de-duplicated on the way in so the
// deterministic coverage math is stable regardless of caller-side repetition.
export const recordValidationRunSchema = z.object({
  subject: z.string().min(1, "A subject is required.").max(2000),
  enginesRun: z
    .array(engineKey)
    .max(200)
    .default([])
    .transform((keys) => Array.from(new Set(keys))),
  requiredEngines: z
    .array(engineKey)
    .max(200)
    .default([])
    .transform((keys) => Array.from(new Set(keys))),
  // Map of source name -> reachable boolean (e.g. { "pubmed": true }).
  sourcesReachable: z
    .record(z.string().min(1).max(200), z.boolean())
    .default({}),
});

export type RecordValidationRunInput = z.infer<typeof recordValidationRunSchema>;
