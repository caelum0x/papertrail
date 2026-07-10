import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { sanitizeClaimText } from "@/lib/api/claimInput";
import { askPaperQa } from "@/lib/paperqa/ask";

// Public agentic Paper QA endpoint (PaperQA2-style). Given a scientific
// question, Claude retrieves the relevant cached papers, READS their full text,
// and answers WITH CITATIONS — every rendered claim grounded to an exact source
// span by lib/grounding.ts. Mirrors app/api/verify/route.ts: nodejs runtime,
// rate-limited, envelope responses, and NEVER logs the question text.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("paper_qa.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let body: { question?: string; limit?: number };
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
      "Question is too long (max 2000 characters). Ask a single focused question.",
  });
  if (!sanitized.ok) {
    return fail(sanitized.error, 400);
  }
  const question = sanitized.value;
  if (question.length < 10) {
    return fail("Please ask a question of at least 10 characters.", 400);
  }

  const rawLimit = body.limit;
  const limit =
    typeof rawLimit === "number" && Number.isFinite(rawLimit)
      ? Math.min(8, Math.max(1, Math.floor(rawLimit)))
      : undefined;

  try {
    const outcome = await askPaperQa(question, limit ? { limit } : undefined);

    if (outcome.status === "no_support_found") {
      logEvent("paper_qa.no_support", { latencyMs: Date.now() - start });
      return ok(outcome);
    }

    logEvent("paper_qa.success", {
      latencyMs: Date.now() - start,
      sources: outcome.sources.length,
      claims: outcome.claims.length,
      droppedClaims: outcome.dropped_claims,
    });
    return ok(outcome);
  } catch (err) {
    logEvent("paper_qa.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/paper-qa] failed:", err);
    return fail(
      "Something went wrong while answering this question. This has been logged — please try again, or rephrase.",
      500
    );
  }
}
