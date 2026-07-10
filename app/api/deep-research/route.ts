import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { sanitizeClaimText } from "@/lib/api/claimInput";
import { runDeepResearch } from "@/lib/deepResearch/run";

// Public MULTI-AGENT DEEP RESEARCH endpoint (gpt-researcher / open_deep_research
// style, but grounded). Given a research question, Claude PLANS 3-6 focused
// sub-questions, the deterministic evidence pipeline gathers verified pooled
// evidence for each, and Claude SYNTHESISES a structured, cited report — every
// number from the engine, every claim grounded to an exact source span.
//
// Mirrors app/api/verify/route.ts and app/api/paper-qa/route.ts: nodejs runtime,
// rate-limited, envelope responses, and NEVER logs the question text.
export const runtime = "nodejs";

// Deep research fans out many Claude + pipeline calls per request, so it is far
// more expensive than a single verify. Charge it a heavier rate-limit weight by
// consuming a stricter bucket than the default compute routes.
const DEEP_RESEARCH_RATE = {
  max: Number(process.env.DEEP_RESEARCH_RATE_MAX || 4),
  windowMs: Number(process.env.DEEP_RESEARCH_RATE_WINDOW_MS || 10 * 60 * 1000),
};

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(`deep-research:${ip}`, DEEP_RESEARCH_RATE);
  if (!rate.allowed) {
    logEvent("deep_research.rate_limited", { ip });
    return fail("Rate limit reached. Deep research is expensive — please try again shortly.", 429);
  }

  let body: { question?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  // Reuse the shared question/claim input hardening (control chars, invisible /
  // bidi smuggling, degenerate repetition, max length) before any LLM sees it.
  const sanitized = sanitizeClaimText(body.question, {
    maxLength: 2000,
    tooLongError:
      "Question is too long (max 2000 characters). Ask a single focused research question.",
  });
  if (!sanitized.ok) {
    return fail(sanitized.error, 400);
  }
  const question = sanitized.value;
  if (question.length < 10) {
    return fail("Please ask a research question of at least 10 characters.", 400);
  }

  try {
    const report = await runDeepResearch(getPool(), question);

    // Strip source raw_text before serialising: the per-sub-question rawTextById
    // maps are grounding-only internals (and the maps aren't JSON-serialisable).
    // The UI highlights via the char offsets already baked into each citation.
    const payload = {
      question: report.question,
      plan: report.plan,
      evidence: report.evidence.map((e) => ({
        sub_question: e.sub_question,
        result: e.result,
      })),
      sources: report.sources,
      summary: report.summary,
      sections: report.sections,
      limitations: report.limitations,
      dropped_claims: report.dropped_claims,
      supported_sub_questions: report.supported_sub_questions,
    };

    logEvent("deep_research.success", {
      latencyMs: Date.now() - start,
      subQuestions: report.plan.sub_questions.length,
      supported: report.supported_sub_questions,
      sources: report.sources.length,
      summaryClaims: report.summary.length,
      sections: report.sections.length,
      droppedClaims: report.dropped_claims,
    });
    return ok(payload);
  } catch (err) {
    logEvent("deep_research.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/deep-research] failed:", err);
    return fail(
      "Something went wrong while running deep research. This has been logged — please try again, or rephrase your question.",
      500
    );
  }
}
