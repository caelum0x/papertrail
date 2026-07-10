import { NextRequest } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { sanitizeClaimText } from "@/lib/api/claimInput";
import { generateHypotheses } from "@/lib/hypotheses/generate";

// Public RESEARCH-GAP + HYPOTHESIS endpoint. Given a topic/claim, it grounds first by
// running the deterministic evidence pipeline (retrieve cached primary sources → pool →
// meta-analysis / publication-bias / GRADE), derives the gap-relevant signals the engine
// established, then has Claude reason over ONLY those signals to surface research gaps and
// testable hypotheses — dropping anything not anchored to a real engine signal.
//
// Compute-route conventions mirror app/api/verify: nodejs runtime, IP rate-limited,
// envelope responses, boundary-validated + sanitised input, and it NEVER logs the topic
// text or any secret — only counts and verdicts.
export const runtime = "nodejs";

const BodySchema = z.object({
  topic: z.string(),
  query: z.string().trim().min(1).max(2000).optional(),
  limit: z.number().int().positive().max(20).optional(),
});

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("hypotheses.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsedBody = BodySchema.safeParse(raw);
  if (!parsedBody.success) {
    const issue = parsedBody.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid hypotheses request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  // Harden the topic exactly like /api/verify (control chars, invisible/bidi smuggling,
  // length cap) BEFORE it reaches retrieval or the LLM. Never log its text.
  const sanitized = sanitizeClaimText(parsedBody.data.topic, {
    maxLength: 2000,
    tooLongError:
      "Topic is too long (max 2000 characters). Paste a single claim or short passage.",
  });
  if (!sanitized.ok) {
    return fail(sanitized.error, 400);
  }
  const topic = sanitized.value;
  if (topic.length < 10) {
    return fail("Please provide a topic of at least 10 characters.", 400);
  }

  try {
    const pool = getPool();
    const result = await generateHypotheses(pool, {
      topic,
      query: parsedBody.data.query,
      limit: parsedBody.data.limit,
    });

    logEvent("hypotheses.success", {
      latencyMs: Date.now() - start,
      evidenceGrounded: result.evidenceGrounded,
      signals: result.signals.length,
      gaps: result.gaps.length,
      hypotheses: result.hypotheses.length,
      droppedUngrounded: result.droppedUngrounded,
      usedSources: result.usedSources.length,
    });

    return ok(result);
  } catch (err) {
    logEvent("hypotheses.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/hypotheses] failed:", err);
    return fail(
      "Something went wrong while analysing research gaps for this topic. This has been logged — please try again.",
      500
    );
  }
}
