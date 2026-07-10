// Zod schemas for the long-form CITED SYNTHESIS report (STORM-style). The engine
// supplies every number; Claude drafts the prose. These schemas live at two seams:
//
//   1. CLAUDE OUTPUT (SynthesisDraftSchema) — the raw multi-section prose Claude
//      returns. Validated the moment it comes back, before anything downstream reads
//      it (the CLAUDE.md rule: never trust a raw JSON.parse of a model response).
//      Claude may cite sources and quote source snippets, but every factual/numeric
//      sentence is GROUNDED against the cached source text afterwards — a quote it
//      cannot point to in a source is dropped, never trusted on the model's word.
//
//   2. ASSEMBLED REPORT (SynthesisReportSchema) — the final object the route returns:
//      Claude's grounded prose sections + the deterministic engine facts (pooled
//      numbers, GRADE certainty, verdict) + the citation trail. This is the shape the
//      UI renders and the export serializes.
//
// Small, explicit, boundary-validated. Nothing here performs I/O.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Section identity. A fixed set of sections so the UI/export can render a stable
// structure and the drafter can't invent an arbitrary document skeleton.
// ---------------------------------------------------------------------------
export const SYNTHESIS_SECTION_IDS = [
  "background",
  "methods",
  "findings",
  "certainty",
  "limitations",
] as const;

export type SynthesisSectionId = (typeof SYNTHESIS_SECTION_IDS)[number];

export const SynthesisSectionIdSchema = z.enum(SYNTHESIS_SECTION_IDS);

// ---------------------------------------------------------------------------
// One factual sentence Claude drafted, with the source ids it cites and (optionally)
// a verbatim snippet it claims comes from one of those sources. The snippet is what
// we GROUND against the cached source text; if Claude supplies no snippet, or the
// snippet can't be located, the sentence is treated as ungrounded.
// ---------------------------------------------------------------------------
export const DraftSentenceSchema = z.object({
  // The prose sentence itself. Kept short-ish so grounding is sentence-granular.
  text: z.string().trim().min(1).max(1200),
  // Source ids (from the provided evidence packet) this sentence draws on. Empty
  // is allowed for non-factual connective prose (e.g. a topic-framing sentence).
  citations: z.array(z.string().min(1)).max(20).default([]),
  // Optional verbatim snippet the sentence rests on, to be located in the cited
  // source's raw_text. Absent for interpretive/connective sentences.
  source_quote: z.string().trim().min(1).max(2000).nullable().default(null),
});
export type DraftSentence = z.infer<typeof DraftSentenceSchema>;

export const DraftSectionSchema = z.object({
  id: SynthesisSectionIdSchema,
  heading: z.string().trim().min(1).max(120),
  sentences: z.array(DraftSentenceSchema).max(60),
});
export type DraftSection = z.infer<typeof DraftSectionSchema>;

// The raw Claude output: the review title + the five sections. We validate this
// exact shape before grounding. Sections may arrive in any order / be partially
// present; the generator normalizes ordering and fills required sections.
export const SynthesisDraftSchema = z.object({
  title: z.string().trim().min(1).max(240),
  sections: z.array(DraftSectionSchema).min(1).max(5),
});
export type SynthesisDraft = z.infer<typeof SynthesisDraftSchema>;

// ---------------------------------------------------------------------------
// Grounded output. After grounding, each sentence carries whether it was grounded
// and (if so) the verbatim source span + offsets we actually located — mirroring
// lib/grounding.ts's GroundedSpan discipline. Ungrounded FACTUAL sentences (had a
// quote/citation but we couldn't locate it) are DROPPED by the generator, not kept.
// ---------------------------------------------------------------------------
export const GroundingRefSchema = z.object({
  source_id: z.string().min(1),
  // The verbatim substring of the source raw_text we located (never the model's
  // paraphrase), with char offsets for in-place highlighting.
  source_span: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  status: z.enum(["exact", "approximate"]),
});
export type GroundingRef = z.infer<typeof GroundingRefSchema>;

export const GroundedSentenceSchema = z.object({
  text: z.string(),
  citations: z.array(z.string()),
  // Present only for grounded factual sentences; null for connective prose.
  grounding: GroundingRefSchema.nullable(),
});
export type GroundedSentence = z.infer<typeof GroundedSentenceSchema>;

export const GroundedSectionSchema = z.object({
  id: SynthesisSectionIdSchema,
  heading: z.string(),
  sentences: z.array(GroundedSentenceSchema),
});
export type GroundedSection = z.infer<typeof GroundedSectionSchema>;

// ---------------------------------------------------------------------------
// The engine facts panel — every NUMBER in the report, stated by the deterministic
// evidence pipeline, never by Claude. The Findings prose must state these verbatim.
// Mirrors the fields the evidence report already computed.
// ---------------------------------------------------------------------------
export const EngineFactsSchema = z.object({
  poolable: z.boolean(),
  measure: z.string().nullable(),
  k: z.number().int().nonnegative().nullable(),
  pooledPoint: z.number().nullable(),
  pooledCiLower: z.number().nullable(),
  pooledCiUpper: z.number().nullable(),
  pooledReductionPercent: z.number().nullable(),
  iSquared: z.number().nullable(),
  certainty: z.enum(["high", "moderate", "low", "very_low"]).nullable(),
  verdict: z.string().nullable(),
  claimedReductionPercent: z.number().nullable(),
  // Human-readable one-liner the engine already produced (the report rationale or
  // the insufficient reason). Displayed and used to seed the drafter's context.
  engineRationale: z.string(),
});
export type EngineFacts = z.infer<typeof EngineFactsSchema>;

// One source in the citation trail the report is built on.
export const ReportSourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable(),
  source_type: z.string(),
});
export type ReportSource = z.infer<typeof ReportSourceSchema>;

// The final assembled, grounded synthesis report the route returns.
export const SynthesisReportSchema = z.object({
  topic: z.string(),
  title: z.string(),
  // Grounded prose, section by section.
  sections: z.array(GroundedSectionSchema),
  // The engine's numbers — the single source of truth for every figure in prose.
  facts: EngineFactsSchema,
  // Sources that contributed to the pooled evidence (the citation trail).
  usedSources: z.array(ReportSourceSchema),
  // Auditability: how many factual sentences were dropped for being ungroundable.
  droppedSentenceCount: z.number().int().nonnegative(),
  // True when the underlying evidence pipeline could pool a defensible estimate.
  grounded: z.boolean(),
});
export type SynthesisReport = z.infer<typeof SynthesisReportSchema>;

// Boundary input for the generator / route.
export const SynthesisReportInputSchema = z.object({
  topic: z.string().trim().min(10).max(2000),
  query: z.string().trim().min(1).max(2000).optional(),
  limit: z.number().int().positive().max(20).optional(),
});
export type SynthesisReportInput = z.infer<typeof SynthesisReportInputSchema>;
