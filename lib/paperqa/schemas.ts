import { z } from "zod";

// Structured outputs for the agentic Paper QA pipeline (PaperQA2-style). Every
// Claude output that flows into an answer MUST be validated against one of these
// schemas before use — we never trust a raw JSON.parse of a model response.

// --- Stage 1: per-source evidence extraction -------------------------------
// For a single retrieved source, Claude reads the full passage and returns the
// snippets relevant to the question. Each `quote` is REQUIRED to be copied
// verbatim from the source text; lib/grounding.ts later enforces that as a code
// invariant (an ungroundable quote is dropped, never trusted).

export const EvidenceSnippetSchema = z.object({
  quote: z
    .string()
    .min(1)
    .describe(
      "A verbatim substring of the source passage that bears on the question. Copy it EXACTLY, character for character — do not paraphrase, summarize, or fix typos."
    ),
  relevance: z
    .string()
    .min(1)
    .describe("One sentence: how this quote answers or informs the question."),
  supports: z
    .enum(["answers", "contradicts", "context"])
    .describe(
      "Whether the quote directly answers the question, contradicts a likely answer, or only provides background context."
    ),
});
export type EvidenceSnippet = z.infer<typeof EvidenceSnippetSchema>;

export const SourceEvidenceSchema = z.object({
  relevant: z
    .boolean()
    .describe("Whether this source contains anything that bears on the question."),
  snippets: z
    .array(EvidenceSnippetSchema)
    .describe("Verbatim evidence snippets from this source (empty if not relevant)."),
});
export type SourceEvidence = z.infer<typeof SourceEvidenceSchema>;

// --- Stage 2: cited-answer synthesis ---------------------------------------
// Claude composes the final answer as a list of claims. Every claim cites the
// source(s) it rests on, and re-quotes the exact evidence span it used. The
// route grounds each cited quote against that source's raw_text and drops any
// claim whose evidence cannot be located — so the rendered answer is, by
// construction, fully grounded in retrieved source text.

export const AnswerClaimSchema = z.object({
  text: z
    .string()
    .min(1)
    .describe("One sentence of the answer. Must be fully supported by its cited evidence."),
  citations: z
    .array(
      z.object({
        source_index: z
          .number()
          .int()
          .nonnegative()
          .describe("Index into the provided sources array that this claim cites."),
        quote: z
          .string()
          .min(1)
          .describe(
            "The verbatim substring of that source that supports this claim. Copy EXACTLY from the source text."
          ),
      })
    )
    .min(1)
    .describe("At least one citation. A claim with no citation is not allowed."),
});
export type AnswerClaim = z.infer<typeof AnswerClaimSchema>;

export const CitedAnswerSchema = z.object({
  answer_claims: z
    .array(AnswerClaimSchema)
    .describe("The answer, decomposed into individually-cited sentences."),
  insufficient: z
    .boolean()
    .describe(
      "True if the retrieved sources do not contain enough evidence to answer the question honestly."
    ),
  caveat: z
    .string()
    .describe(
      "A short honest caveat about what the retrieved evidence can and cannot support (empty string if none)."
    ),
});
export type CitedAnswer = z.infer<typeof CitedAnswerSchema>;

// --- API request ------------------------------------------------------------

export const PaperQaRequestSchema = z.object({
  question: z.string().trim().min(10).max(2000),
  limit: z.number().int().min(1).max(8).optional(),
});
export type PaperQaRequest = z.infer<typeof PaperQaRequestSchema>;
