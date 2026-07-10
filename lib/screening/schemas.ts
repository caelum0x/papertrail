import { z } from "zod";

// Boundary + LLM-output validation for AI active-learning screening (ASReview-style).
// Claude ranks candidate records by relevance to a systematic review's inclusion
// criteria so a reviewer screens the most-likely-relevant first. EVERY structured
// Claude output is parsed through these schemas before use — never trust raw JSON.

// The verdict Claude assigns each record. `uncertain` is a first-class outcome:
// forcing a binary include/exclude on a thin abstract is worse than an honest
// "needs a human look" — mirrors the project's no_support_found honesty rule.
export const SCREENING_VERDICTS = ["include", "exclude", "uncertain"] as const;
export type ScreeningVerdict = (typeof SCREENING_VERDICTS)[number];

// One candidate record handed to Claude for ranking. `id` ties the model's
// judgement back to the exact sr_record row; title/abstract are the only signal
// Claude sees (abstract may be absent — the model must rank title-only honestly).
export interface RankableRecord {
  id: string;
  title: string;
  abstract: string | null;
}

// One element of Claude's ranking array. `relevance` is a 0..1 probability the
// record meets the inclusion criteria; `rationale` must be a one-line justification
// GROUNDED in the record's own title/abstract (checked downstream, not fabricated).
export const AiRankItemSchema = z.object({
  id: z.string().min(1),
  relevance: z.number().min(0).max(1),
  verdict: z.enum(SCREENING_VERDICTS),
  rationale: z.string().trim().min(1).max(400),
});
export type AiRankItem = z.infer<typeof AiRankItemSchema>;

// Claude's full response: one item per input record, no more. We validate length
// and id-coverage against the input in the engine, not here (Zod can't see the input).
export const AiRankResponseSchema = z.object({
  rankings: z.array(AiRankItemSchema).max(500),
});
export type AiRankResponse = z.infer<typeof AiRankResponseSchema>;

// Request body for POST /api/screening/ai-rank. `projectId` is the review to rank
// pending records for; `limit` caps how many pending records are ranked this call
// (protects token budget on large reviews — see Known Constraints in CLAUDE.md).
export const aiRankRequestSchema = z.object({
  projectId: z.string().uuid("A valid systematic-review project id is required."),
  limit: z.number().int().min(1).max(200).optional(),
});
export type AiRankRequestInput = z.infer<typeof aiRankRequestSchema>;

// One ranked record returned to the client, enriched with the record title so the
// UI can render a ranked worklist without a second fetch. `groundingOk` reports
// whether the rationale was verified against the abstract span (trust signal).
export interface RankedRecord {
  id: string;
  title: string;
  relevance: number;
  verdict: ScreeningVerdict;
  rationale: string;
  groundingOk: boolean;
}
