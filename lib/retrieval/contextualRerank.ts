// Contextual reranking — a NATIVE TypeScript port of paper-qa's RCS
// (relevance-scored contextual summarization) evidence step
// (backend/engines/paper-qa/src/paperqa/core.py::_map_fxn_summary +
//  src/paperqa/prompts.py::summary_json_system_prompt).
//
// paper-qa never feeds a raw retrieved chunk straight into an answer. Every chunk
// is first passed through a query-conditioned "map" step: the summary LLM reads the
// chunk together with the question and returns
//     { "summary": "<relevant info only, or empty>", "relevance_score": 0-10 }
// where `relevance_score` is 0 when the chunk is not applicable to the question.
// Downstream, paper-qa FILTERS OUT low-scoring contexts (0 is the "not applicable"
// sentinel it drops) and RE-RANKS the survivors by score before they may enter an
// answer. If nothing clears the bar, no evidence is used — it refuses rather than
// answering from irrelevant text.
//
// This module ports that exact shape over OUR cached `sources` rows. The LLM step
// (produce { relevanceScore, contextSummary } for one source against the query) is
// the ONE part paper-qa did with a trained model, so it goes through Claude via
// callClaudeForJson + a Zod schema. Everything after that — dropping sources below
// the documented threshold and re-ordering by descending score — is PURE,
// DETERMINISTIC native TS and is what the tests pin against mocked scores.
//
// The scorer is INJECTABLE so the filtering + re-ordering logic can be exercised
// fully offline without any Claude call.

import { z } from "zod";
import { callClaudeForJson } from "../claude";

// ---------------------------------------------------------------------------
// Threshold — ported from paper-qa's evidence-filtering behavior.
//
// paper-qa scores relevance 0-10 and treats 0 as the "not applicable" sentinel it
// filters out (core.py comment: "we filter out 0s in another place"). Its default
// answer settings keep only sufficiently-relevant contexts; a chunk that scores at
// or below the floor is not allowed to inform an answer. We adopt a documented
// minimum score of 5 (paper-qa's own neutral default when no score is assigned):
// a source must clear STRICTLY ABOVE nothing but AT LEAST this floor to survive.
// Anything below is dropped, exactly as paper-qa drops irrelevant/low contexts.
//
// Kept as an exported constant so the demo and tests reference one documented value.
// ---------------------------------------------------------------------------
export const RELEVANCE_THRESHOLD = 5;

// The 0-10 relevance scale bounds, matching paper-qa's summary_json prompt.
export const MIN_RELEVANCE_SCORE = 0;
export const MAX_RELEVANCE_SCORE = 10;

// A source as it comes in: only the fields the map step needs. Callers typically
// pass retrievalAgent / hybridSearch hits, which are shape-compatible (id + raw_text).
export interface RerankSource {
  id: string;
  raw_text: string;
}

// The RCS map result for a single source: a query-conditioned relevance score plus
// the contextual summary the model produced (the "relevant information only, or
// empty" that paper-qa carries forward instead of the raw chunk).
export interface RerankScore {
  relevanceScore: number;
  contextSummary: string;
}

// A source that CLEARED the threshold: original id + raw_text, its relevance score,
// and its contextual summary. Returned in descending-score order.
export interface RerankedSource extends RerankSource {
  relevanceScore: number;
  contextSummary: string;
}

// The per-source scorer. Defaults to the Claude-backed implementation below; tests
// inject a deterministic fake so the filter/re-rank logic runs offline.
export type ContextScorer = (
  query: string,
  source: RerankSource
) => Promise<RerankScore>;

export interface ContextualRerankDeps {
  scoreSource?: ContextScorer;
  threshold?: number;
}

// ---------------------------------------------------------------------------
// Zod schema for the LLM map output — paper-qa's { summary, relevance_score }.
// Never trust raw JSON.parse of an LLM response (repo convention): the score is
// coerced into the documented 0-10 integer range and the summary defaulted to
// empty, mirroring paper-qa's tolerant parser (which rounds/repairs scores and
// treats a missing/empty summary as "not applicable").
// ---------------------------------------------------------------------------
const rerankScoreSchema = z
  .object({
    summary: z.string().default(""),
    relevance_score: z.coerce
      .number()
      .transform((n) => Math.round(n))
      .pipe(z.number().min(MIN_RELEVANCE_SCORE).max(MAX_RELEVANCE_SCORE)),
  })
  .transform(
    (o): RerankScore => ({
      relevanceScore: o.relevance_score,
      contextSummary: o.summary.trim(),
    })
  );

// System prompt ported from paper-qa's summary_json_system_prompt: produce a
// summary of ONLY the relevant information plus an integer 0-10 relevance score,
// leaving the summary empty and the score 0 when the excerpt is not applicable.
const RERANK_SYSTEM_PROMPT =
  "Provide a summary of the relevant information in the excerpt that could help" +
  " answer the question. Your summary, combined with many others, will be used to" +
  " assess a source. Respond ONLY with JSON of the form:" +
  '\n\n{"summary": "...", "relevance_score": 0-10}\n\n' +
  "where `summary` is the relevant information from the excerpt (a few sentences)" +
  " and `relevance_score` is an integer from 0 to 10 for how relevant that summary" +
  " is to the question. The excerpt may or may not contain relevant information." +
  " If it does not, leave `summary` empty and make `relevance_score` be 0." +
  " Do not answer the question; only summarize supporting evidence.";

// The Claude-backed scorer: the single step paper-qa performed with a trained model.
function buildUserPrompt(query: string, rawText: string): string {
  // Mirror paper-qa's summary_json_prompt layout: excerpt, then the question.
  return `Excerpt:\n\n---\n\n${rawText}\n\n---\n\nQuestion: ${query}`;
}

const defaultScorer: ContextScorer = async (query, source) =>
  callClaudeForJson({
    system: RERANK_SYSTEM_PROMPT,
    user: buildUserPrompt(query, source.raw_text),
    schema: rerankScoreSchema,
    maxTokens: 512,
  });

// ---------------------------------------------------------------------------
// filterAndRank — PURE, DETERMINISTIC. Given each source's RCS score, drop those
// below the threshold and re-order the survivors by descending relevance score.
//
// This is the native part of paper-qa's evidence step: contexts scoring below the
// floor are removed, the rest are sorted best-first. Ties on score are broken by a
// stable secondary sort on id so ordering is deterministic across runs. Returns an
// honest empty array when nothing qualifies.
// ---------------------------------------------------------------------------
export function filterAndRank(
  scored: ReadonlyArray<RerankedSource>,
  threshold: number = RELEVANCE_THRESHOLD
): RerankedSource[] {
  return scored
    .filter((s) => s.relevanceScore >= threshold)
    .slice()
    .sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

// ---------------------------------------------------------------------------
// contextualRerank — the public entry point. For each source, get a
// query-conditioned relevance score + contextual summary (Claude by default,
// injectable for tests), then FILTER below-threshold sources and RE-RANK the
// survivors by score. Returns the ordered, summarized, above-threshold sources —
// or an honest empty array when none qualify (paper-qa's refuse-when-none-clear).
// ---------------------------------------------------------------------------
export async function contextualRerank(
  query: string,
  sources: ReadonlyArray<RerankSource>,
  deps: ContextualRerankDeps = {}
): Promise<RerankedSource[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new Error("contextualRerank: query must be a non-empty string");
  }
  if (sources.length === 0) return [];

  const scoreSource = deps.scoreSource ?? defaultScorer;
  const threshold = deps.threshold ?? RELEVANCE_THRESHOLD;

  // Score every source against the query. Each map is independent — run concurrently.
  // A source whose scoring fails is treated as not-applicable (score 0, empty
  // summary) rather than sinking the whole rerank, matching paper-qa's per-context
  // resilience (a failed context is simply dropped, others proceed).
  const scored = await Promise.all(
    sources.map(async (source): Promise<RerankedSource> => {
      try {
        const { relevanceScore, contextSummary } = await scoreSource(
          trimmed,
          source
        );
        return {
          id: source.id,
          raw_text: source.raw_text,
          relevanceScore,
          contextSummary,
        };
      } catch {
        return {
          id: source.id,
          raw_text: source.raw_text,
          relevanceScore: MIN_RELEVANCE_SCORE,
          contextSummary: "",
        };
      }
    })
  );

  return filterAndRank(scored, threshold);
}
