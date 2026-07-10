import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { ResearchRequestSchema } from "@/lib/research/schemas";
import { runResearch } from "@/lib/research/orchestrator";

export const runtime = "nodejs";

// Native parallel deep-research over PaperTrail's cached sources. Assimilates the
// gpt-researcher + open_deep_research orchestration (plan -> parallel sub-query
// research -> per-source compression -> cited report), grounded to real source spans.
//
// Public route, mirroring /api/verify: rate-limited, Zod-validated input, {success,
// data, error} envelope. Never logs the question text (only lengths / counts), per
// the "no claim text or API keys in logs" convention.

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = ResearchRequestSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid research request.";
    return fail(message, 400);
  }

  try {
    const result = await runResearch(parsed.data.question);
    console.info("[research] completed", {
      latencyMs: Date.now() - start,
      subQuestions: result.plan.sub_questions.length,
      summaryClaims: result.report.summary.length,
      droppedCitations: result.report.grounding_dropped_citations,
    });
    return ok(result);
  } catch (err) {
    // User-visible fallback state; detailed context stays server-side and carries no
    // question text (only the error class/message).
    console.error("[research] failed", {
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "unknown",
    });
    return fail(
      "Couldn't complete the research run. Please try again or narrow the question.",
      502
    );
  }
}
