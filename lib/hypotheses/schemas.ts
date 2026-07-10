// Zod schemas for the RESEARCH-GAP + HYPOTHESIS engine (lib/hypotheses/generate.ts).
//
// The trust contract lives here. There are two schema families:
//
//  1. EVIDENCE SIGNALS — DETERMINISTIC facts the engine (runEvidencePipeline →
//     buildEvidenceReport) already established: heterogeneity, wide CIs, few studies,
//     imprecision, publication-bias asymmetry, no-support-found, etc. Each carries a
//     stable `id`, the concrete numbers behind it, and a plain-language `detail`. These
//     are computed, never model-guessed — they are the ground truth Claude reasons over.
//
//  2. Claude's OUTPUT — gap cards + testable hypotheses. EVERY gap MUST cite a
//     `signal_id` that exists in the deterministic signal set (validated in generate.ts
//     after parsing). A gap whose `signal_id` is unknown is dropped: Claude may reason
//     over the evidence base, but it may NOT invent a finding the engine didn't produce.
//
// All Claude output is validated against HypothesesLlmOutputSchema (via callClaudeForJson)
// before use — never trust raw JSON.parse of a model response.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Input. A topic/claim drives runEvidencePipeline; `query` optionally steers the
// semantic retrieval independently of the claim wording. Mirrors the pipeline input
// bounds so a route can hand raw JSON straight through.
// ---------------------------------------------------------------------------
export const HypothesesInputSchema = z.object({
  topic: z.string().trim().min(10).max(2000),
  query: z.string().trim().min(1).max(2000).optional(),
  limit: z.number().int().positive().max(20).optional(),
});
export type HypothesesInput = z.infer<typeof HypothesesInputSchema>;

// ---------------------------------------------------------------------------
// EVIDENCE SIGNALS — the deterministic gap-relevant facts derived from the engine.
// `kind` is a closed set so both the engine (producer) and the UI (consumer) agree
// on the categories a gap can be built from.
// ---------------------------------------------------------------------------
export const EvidenceSignalKindSchema = z.enum([
  "no_support_found", // retrieval/extraction found no poolable body of evidence
  "few_studies", // pooled, but k is small (fragile pool / no prediction interval)
  "high_heterogeneity", // I² above the inconsistency threshold — effect not consistent
  "wide_confidence_interval", // pooled CI spans an appreciable range — imprecise
  "crosses_null", // pooled CI includes the null — effect not established
  "publication_bias", // Egger's asymmetry — possible small-study/publication bias
  "low_certainty", // GRADE certainty is low / very_low
  "claim_pool_mismatch", // the claim's magnitude disagrees with the pooled effect
]);
export type EvidenceSignalKind = z.infer<typeof EvidenceSignalKindSchema>;

// One deterministic signal. `id` is stable within a single run (e.g. "sig-het") so a
// gap can reference it; `metrics` carries the concrete numbers so the UI can show the
// exact engine value behind the gap (I²=…, CI=…–…, k=…).
export const EvidenceSignalSchema = z.object({
  id: z.string().min(1),
  kind: EvidenceSignalKindSchema,
  detail: z.string().min(1),
  metrics: z.record(z.union([z.number(), z.string()])).default({}),
});
export type EvidenceSignal = z.infer<typeof EvidenceSignalSchema>;

// ---------------------------------------------------------------------------
// Claude OUTPUT schema. Kept minimal — the numbers stay with the signals; Claude adds
// the reasoning (why this is a gap) and the testable hypotheses tied to it.
// ---------------------------------------------------------------------------

// A single research gap Claude surfaced. `signal_id` MUST match a deterministic signal
// (enforced post-parse in generate.ts). `why_gap` explains, in translational-research
// terms, what the pooled evidence does NOT establish.
export const ResearchGapSchema = z.object({
  signal_id: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  why_gap: z.string().trim().min(1).max(1200),
  affected_population: z.string().trim().max(400).nullable().default(null),
});
export type ResearchGap = z.infer<typeof ResearchGapSchema>;

// A testable hypothesis tied to a specific gap (by `signal_id`). `testable_prediction`
// is the falsifiable statement; `suggested_design` is how one might test it. `rationale`
// grounds it in the cited signal.
export const HypothesisSchema = z.object({
  signal_id: z.string().min(1),
  statement: z.string().trim().min(1).max(600),
  testable_prediction: z.string().trim().min(1).max(600),
  suggested_design: z.string().trim().min(1).max(600),
  rationale: z.string().trim().min(1).max(1200),
});
export type Hypothesis = z.infer<typeof HypothesisSchema>;

// What Claude must return. Bounded arrays so a runaway generation can't produce an
// unusable wall of speculation — the point is a few sharp, grounded gaps.
export const HypothesesLlmOutputSchema = z.object({
  gaps: z.array(ResearchGapSchema).max(12),
  hypotheses: z.array(HypothesisSchema).max(12),
  synthesis: z.string().trim().min(1).max(2000),
});
export type HypothesesLlmOutput = z.infer<typeof HypothesesLlmOutputSchema>;

// ---------------------------------------------------------------------------
// The engine's full result shape (returned by generateHypotheses / the route). Carries
// the deterministic signals AND Claude's grounded output, plus the citation trail from
// the pipeline so the caller can see WHICH sources the analysis rests on.
// ---------------------------------------------------------------------------
export interface UsedSourceRef {
  id: string;
  title: string | null;
  source_type: string;
}

export interface HypothesesResult {
  topic: string;
  // Whether a poolable body of evidence was assembled at all. When false, the only
  // honest signal is `no_support_found` and hypotheses target the absence itself.
  evidenceGrounded: boolean;
  signals: EvidenceSignal[];
  gaps: ResearchGap[];
  hypotheses: Hypothesis[];
  synthesis: string;
  usedSources: UsedSourceRef[];
  // Count of gaps/hypotheses Claude produced that referenced an unknown signal and were
  // dropped for being ungrounded — surfaced for transparency, never hidden.
  droppedUngrounded: number;
}
