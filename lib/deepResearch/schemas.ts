import { z } from "zod";

// DEEP RESEARCH schemas — the Zod contracts for the two structured Claude
// outputs in the multi-agent deep-research workflow (gpt-researcher /
// open_deep_research-style, but grounded). Every Claude structured output in
// this workflow is validated against one of these before it is trusted.
//
// Stage 1 (PLAN): Claude decomposes a research question into focused
//   sub-questions. Validated by ResearchPlanSchema.
// Stage 3 (SYNTHESIS): Claude writes a structured report across the per-
//   sub-question evidence, where every claim cites a source and every number
//   traces to the deterministic engine. Validated by SynthesisReportSchema.
//
// The numbers themselves NEVER come from Claude — they come from the evidence
// pipeline. Claude cites; the engine computes. Any synthesis claim whose quote
// cannot be grounded to a source span (lib/grounding.ts) is dropped downstream.

// --- Stage 1: research plan (Claude decomposes the question) -----------------

export const SubQuestionSchema = z.object({
  question: z
    .string()
    .trim()
    .min(10)
    .max(400)
    .describe("A focused, individually-answerable sub-question."),
  rationale: z
    .string()
    .trim()
    .min(1)
    .max(600)
    .describe("Why answering this sub-question advances the overall question."),
  // A retrieval steer distinct from the sub-question wording, used to drive the
  // evidence pipeline's semantic search. Optional: falls back to `question`.
  search_query: z.string().trim().min(1).max(400).optional(),
});
export type SubQuestion = z.infer<typeof SubQuestionSchema>;

export const ResearchPlanSchema = z.object({
  interpretation: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .describe("A one-paragraph restatement of what the question is really asking."),
  sub_questions: z.array(SubQuestionSchema).min(3).max(6),
});
export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;

// --- Stage 3: synthesised report (Claude writes across the sub-answers) ------

// One citation inside a synthesis claim. `quote` MUST be copied verbatim from a
// source span presented to Claude; it is re-grounded against the source raw_text
// before being trusted, and dropped if it cannot be located.
export const SynthesisCitationSchema = z.object({
  source_id: z.string().min(1).describe("The id of the cited source."),
  quote: z
    .string()
    .trim()
    .min(1)
    .max(1200)
    .describe("A verbatim substring of the cited source's raw_text."),
});
export type SynthesisCitation = z.infer<typeof SynthesisCitationSchema>;

export const SynthesisClaimSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1)
    .max(1200)
    .describe("One sentence of the report, fully supported by its citations."),
  citations: z.array(SynthesisCitationSchema).min(1),
});
export type SynthesisClaim = z.infer<typeof SynthesisClaimSchema>;

export const SynthesisSectionSchema = z.object({
  sub_question: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .describe("The sub-question this section answers (echoed from the plan)."),
  claims: z.array(SynthesisClaimSchema),
});
export type SynthesisSection = z.infer<typeof SynthesisSectionSchema>;

export const SynthesisReportSchema = z.object({
  // A short abstract-style overview claim set — each still individually cited.
  summary: z.array(SynthesisClaimSchema),
  sections: z.array(SynthesisSectionSchema),
  // Honest, one-paragraph limitations of the assembled evidence (or "" if none).
  limitations: z.string().trim().max(2000),
});
export type SynthesisReport = z.infer<typeof SynthesisReportSchema>;
