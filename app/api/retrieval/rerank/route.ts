import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { rankByClaimFrame } from "@/lib/agents/contextualRank";

// Public POST endpoint for CLAIM-FRAME ON-TOPIC RERANKING. Given { claim, sources:
// [{id, text}] } it extracts the claim frame (subject / predicate / object /
// modifiers) and DETERMINISTICALLY scores each candidate source for on-topic frame
// overlap in [0,1], returning the kept sources (best first, with match provenance)
// and which candidate ids were dropped as off-topic. This is a native TS mirror of
// backend/engines/OpenFactVerification/papertrail_rerank.py — the noise gate that
// sits on top of hybrid retrieval and cuts off-topic candidates ~40-60% before any
// expensive verification runs.
//
// MOAT: no LLM decides the numeric rank — deterministic frame-overlap math does.
// A single grounded Claude pass TAGS survivors as on-topic (advisory only; every tag
// must quote a real substring of the source or it is dropped), but the ranking is
// always the deterministic score. The Claude relevance pass runs BY DEFAULT (full
// capacity); pass `llm: false` to get the pure deterministic ranking with no model call.
export const runtime = "nodejs";

const RerankRequestSchema = z.object({
  claim: z.string().trim().min(1, "claim must be a non-empty string.").max(2000),
  sources: z
    .array(
      z.object({
        id: z.string().min(1, "each source needs a non-empty id."),
        text: z.string().min(1, "each source needs non-empty text."),
      })
    )
    .min(1, "provide at least one source to rerank.")
    .max(100, "too many sources — rerank at most 100 at a time."),
  threshold: z.number().min(0).max(1).optional(),
  llm: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("retrieval.rerank.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = RerankRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid rerank request — ${where}${issue?.message ?? "provide a claim plus sources[{id, text}]."}`,
      400
    );
  }

  try {
    const { claim, sources, threshold, llm } = parsed.data;
    // Grounded Claude relevance tagging runs by default (full capacity); callers can
    // opt out with `llm: false` for a pure deterministic ranking.
    const useLlm = llm ?? true;
    const result = await rankByClaimFrame(claim, sources, { threshold, llm: useLlm });

    logEvent("retrieval.rerank.success", {
      latencyMs: Date.now() - start,
      sourceCount: sources.length,
      keptCount: result.ranked.length,
      droppedCount: result.droppedIds.length,
      relevanceUngroundedCount: result.relevanceUngroundedCount,
      llm: useLlm,
    });

    return ok(result);
  } catch (err) {
    logEvent("retrieval.rerank.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/retrieval/rerank] failed:", err);
    return fail(
      "Something went wrong while reranking the candidate sources. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
