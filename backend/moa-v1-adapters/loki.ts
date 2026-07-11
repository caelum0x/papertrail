// MoA expert adapter — Loki / OpenFactVerification, exposed as an interchangeable
// "expert" agent. Loki here is a claim-frame ON-TOPIC RERANKER: it does not vote on
// whether the claim is true, it triages which sources are actually on-topic for the
// claim (right intervention + right outcome + right population) and drops surface-word
// noise. That is a CONTEXT/weighting contribution, so its signal is always `neutral`.
//
// Engine lib: lib/agents/contextualRank.ts::rankByClaimFrame(claim, sources, {llm}).
//   - The numeric rank is DETERMINISTIC (frame-overlap set arithmetic); confidence is
//     read straight off the top ranked score, never from an LLM.
//   - Claude runs ONLY when ctx.options.llm is set, and only as the lib's internal
//     grounded relevance pass (tag + verbatim quote, locateSpan-checked). We surface
//     that already-grounded quote and set usedClaude accordingly — no new LLM call here.
//   - Stateless: rankByClaimFrame needs no DB pool and does no network beyond the
//     optional Claude call the lib already owns.

import type { Expert, OrchestrationContext, ExpertContribution, GroundedSpan } from "../types";
import { makeContribution, skippedContribution, erroredContribution, clamp01 } from "../types";
import {
  rankByClaimFrame,
  type RerankSource,
  type RankedSource,
} from "../../agents/contextualRank";

// Gate constants. Relevance triage adds the most value when there are multiple
// candidates to separate on-topic from off-topic; with a single source there is
// nothing to triage against, so the engine is only marginally useful (low gate).
const GATE_MULTI_SOURCE = 0.8;
const GATE_SINGLE_SOURCE = 0.3;

// Cap how many ranked survivors we echo into the detail payload so the UI stays light.
const MAX_DETAIL_RANKED = 25;

const EXPERT_ID = "loki";

const expert: Expert = {
  id: EXPERT_ID,
  name: "Loki on-topic reranker",
  category: "retrieval",
  description:
    "Claim-frame relevance triage: ranks sources by on-topic overlap (intervention + " +
    "outcome + population) and drops surface-word noise. Weights context; does not vote.",

  // Pure + deterministic: usefulness is a function of how many sources there are to
  // triage. No I/O, no LLM, no throwing.
  gate(ctx: OrchestrationContext): number {
    const withText = ctx.sources.filter((s) => s.text.trim().length > 0).length;
    if (withText === 0) return 0;
    if (withText === 1) return GATE_SINGLE_SOURCE;
    return GATE_MULTI_SOURCE;
  },

  async run(ctx: OrchestrationContext): Promise<ExpertContribution> {
    const claim = ctx.claim.trim();
    const candidates: RerankSource[] = ctx.sources
      .filter((s) => s.text.trim().length > 0)
      .map((s) => ({ id: s.id, text: s.text }));

    if (claim.length === 0) {
      return skippedContribution(EXPERT_ID, "No claim text to build a claim frame from.");
    }
    if (candidates.length === 0) {
      return skippedContribution(EXPERT_ID, "No sources with text to rank for relevance.");
    }

    // Claude only runs if the lib's grounded relevance pass is enabled AND the caller
    // permits LLM steps. Everything numeric (frame overlap, rank, threshold) is
    // deterministic regardless.
    const useLlm = ctx.options.llm === true;

    try {
      const result = await rankByClaimFrame(claim, candidates, { llm: useLlm });

      const top: RankedSource | undefined = result.ranked[0];
      // Confidence is the deterministic top frame-overlap score. If everything was
      // dropped as off-topic, there is no on-topic evidence to weight — honest skip.
      if (top === undefined) {
        return skippedContribution(
          EXPERT_ID,
          `All ${candidates.length} source(s) fell below the on-topic threshold; nothing to rank.`
        );
      }

      const confidence = clamp01(top.score);

      // Surface only the lib's ALREADY-grounded on-topic quotes (locateSpan-verified
      // inside rankByClaimFrame). Never fabricate a span.
      const sourceTextById = new Map(candidates.map((c) => [c.id, c.text] as const));
      const groundedSpans: GroundedSpan[] = [];
      for (const r of result.ranked) {
        const tag = r.relevance;
        if (tag?.onTopic !== true || tag.groundedQuote === null) continue;
        const text = sourceTextById.get(r.id);
        if (text === undefined) continue;
        const start = text.indexOf(tag.groundedQuote);
        if (start < 0) continue; // defensive: only emit a real substring.
        groundedSpans.push({
          sourceId: r.id,
          text: tag.groundedQuote,
          start,
          end: start + tag.groundedQuote.length,
        });
      }

      const rankedDetail = result.ranked.slice(0, MAX_DETAIL_RANKED).map((r) => ({
        id: r.id,
        score: Number(r.score.toFixed(4)),
        subjectMatched: r.subjectMatched,
        objectMatched: r.objectMatched,
        modifierMatched: r.modifierMatched,
        predicateMatched: r.predicateMatched,
        onTopic: r.relevance?.onTopic ?? null,
      }));

      const summary =
        `Ranked ${result.ranked.length} on-topic source(s) by claim-frame overlap` +
        (result.droppedIds.length > 0
          ? `, dropped ${result.droppedIds.length} off-topic`
          : "") +
        `; top relevance ${confidence.toFixed(2)}.`;

      return makeContribution(EXPERT_ID, {
        ran: true,
        // Retrieval triage weights context; it never asserts support/refute.
        signal: "neutral",
        confidence,
        summary,
        usedClaude: useLlm,
        groundedSpans,
        detail: {
          topScore: confidence,
          keptCount: result.ranked.length,
          droppedCount: result.droppedIds.length,
          droppedIds: result.droppedIds,
          relevanceUngroundedCount: result.relevanceUngroundedCount,
          frame: {
            subject: result.frame.subject,
            predicate: result.frame.predicate,
            direction: result.frame.direction,
            object: result.frame.object,
            modifiers: result.frame.modifiers,
          },
          ranked: rankedDetail,
          rankedTruncated: result.ranked.length > MAX_DETAIL_RANKED,
        },
      });
    } catch (err: unknown) {
      return erroredContribution(EXPERT_ID, err);
    }
  },
};

export default expert;
