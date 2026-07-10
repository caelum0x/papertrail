import { z } from "zod";

// Structured full-paper extraction (RobotReviewer / LlamaExtract-style). Claude
// reads the FULL raw_text and returns PICO + every reported effect size + the
// endpoints. Each effect carries the VERBATIM supporting quote the model claims
// backs the number — the deterministic trust layer (lib/grounding.ts) then locates
// that quote as an exact span of raw_text, and lib/effectSize reconciles the number.
// Any effect whose quote can't be grounded is dropped/flagged. No fabricated numbers.

// --- PICO ---------------------------------------------------------------------

export const PicoSchema = z.object({
  population: z
    .string()
    .describe("Who was studied — the specific population/subgroup, e.g. 'adults 65+ with prior MI'. Use 'not reported' if absent."),
  intervention: z
    .string()
    .describe("The treatment/exposure under study, e.g. 'empagliflozin 10 mg daily'. Use 'not reported' if absent."),
  comparator: z
    .string()
    .describe("What the intervention was compared against, e.g. 'placebo' or 'standard of care'. Use 'not reported' if absent."),
  outcomes: z
    .array(z.string())
    .describe("The outcomes/endpoints measured, primary first, e.g. ['CV death or HF hospitalization', 'all-cause mortality']."),
});
export type Pico = z.infer<typeof PicoSchema>;

// --- Endpoints ----------------------------------------------------------------

export const EndpointRoleEnum = z.enum(["primary", "secondary", "safety", "other"]);
export type EndpointRole = z.infer<typeof EndpointRoleEnum>;

export const EndpointSchema = z.object({
  name: z.string().describe("The endpoint as named in the paper."),
  role: EndpointRoleEnum.describe("Whether this is a primary, secondary, safety, or other endpoint."),
  timepoint: z
    .string()
    .describe("When it was measured, e.g. 'at 24 months'. Use 'not reported' if absent."),
});
export type Endpoint = z.infer<typeof EndpointSchema>;

// --- Effect records -----------------------------------------------------------

// The measure vocabulary the model is asked to tag each effect with. This mirrors
// lib/effectSize's EffectMeasure so a reconciliation can line up on the same axis.
export const EffectMeasureEnum = z.enum(["RR", "HR", "OR", "RRR", "absolute", "unknown"]);
export type ClaudeEffectMeasure = z.infer<typeof EffectMeasureEnum>;

// One reported effect size, AS EXTRACTED by Claude (pre-grounding). `quote` is the
// exact sentence/clause the model says reports this effect — it MUST be copied
// verbatim from the source so the grounding layer can locate it. The numbers are
// what the model read; they are only trusted after deterministic reconciliation.
export const ExtractedEffectSchema = z.object({
  endpoint: z.string().describe("Which endpoint this effect is for — should match one of the endpoints/outcomes."),
  measure: EffectMeasureEnum.describe("The effect measure type."),
  point: z
    .number()
    .nullable()
    .describe("The point estimate as a number, e.g. 0.75 for HR 0.75, or 26 for a 26% relative reduction. null if not numeric."),
  ci_low: z.number().nullable().describe("Lower 95% CI bound, or null."),
  ci_high: z.number().nullable().describe("Upper 95% CI bound, or null."),
  is_percent: z.boolean().describe("True when point is a percentage (e.g. a 26% relative risk reduction)."),
  quote: z
    .string()
    .describe("The EXACT verbatim substring of the source text that reports this effect. Copy it character-for-character — do not paraphrase, summarize, or reformat numbers."),
});
export type ExtractedEffect = z.infer<typeof ExtractedEffectSchema>;

// The raw (pre-grounding) structured extraction returned by Claude and validated
// against this schema before ANY of it is trusted.
export const PaperExtractionSchema = z.object({
  pico: PicoSchema,
  endpoints: z.array(EndpointSchema),
  effects: z.array(ExtractedEffectSchema),
});
export type PaperExtraction = z.infer<typeof PaperExtractionSchema>;

// --- Grounded output (what callers/UI actually consume) -----------------------

// How the reconciliation of a Claude-read number against the deterministic
// lib/effectSize parse turned out.
export const EffectReconciliationEnum = z.enum([
  // The deterministic parse of the grounded quote found a matching effect that
  // agrees with the number Claude reported.
  "confirmed",
  // The quote grounded, but the deterministic parser read a different number than
  // Claude did — surfaced, not silently trusted.
  "mismatch",
  // The quote grounded, but the deterministic parser couldn't extract a numeric
  // effect from it to cross-check (e.g. an absolute change it doesn't model).
  "unverified",
]);
export type EffectReconciliation = z.infer<typeof EffectReconciliationEnum>;

// A single effect AFTER grounding: the quote has been located as an exact span of
// raw_text (verbatim text + char offsets) and the number reconciled against the
// deterministic parse. Effects whose quote could not be grounded never reach here.
export interface GroundedEffect {
  endpoint: string;
  measure: ClaudeEffectMeasure;
  /** The number Claude read from the source. */
  claimed_point: number | null;
  claimed_ci_low: number | null;
  claimed_ci_high: number | null;
  is_percent: boolean;
  /** The verbatim source substring we located (NOT the model's copy) + offsets. */
  quote: string;
  grounding: { status: "exact" | "approximate"; start: number; end: number };
  /** Deterministic cross-check outcome. */
  reconciliation: EffectReconciliation;
  /** The number the deterministic parser read from the grounded quote (when any). */
  parsed_point: number | null;
  /** One-line, defensible note explaining the reconciliation verdict. */
  note: string;
}

// The complete, trusted result: PICO + endpoints + grounded effects, plus how many
// model-produced effects were dropped for being ungroundable.
export interface PaperExtractResult {
  pico: Pico;
  endpoints: Endpoint[];
  effects: GroundedEffect[];
  /** Effects the model returned whose quote could not be located in raw_text. */
  ungrounded_dropped_count: number;
  /** Total effects the model produced (grounded + dropped). */
  total_effects_extracted: number;
  source: {
    id: string | null;
    title: string | null;
    external_id: string | null;
    source_type: string | null;
    url: string | null;
  };
}
