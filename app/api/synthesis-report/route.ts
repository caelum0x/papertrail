import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { checkRateLimit } from "@/lib/rateLimit";
import { sanitizeClaimText } from "@/lib/api/claimInput";
import { ok, fail } from "@/lib/api/response";
import { logEvent } from "@/lib/logger";
import { generateSynthesisReport } from "@/lib/synthesisReport/generate";

export const runtime = "nodejs";

// PUBLIC compute route: topic/claim IN → a long-form, fully-cited evidence review OUT
// (STORM-style). Mirrors /api/verify + /api/evidence-pipeline hardening — nodejs runtime,
// IP rate limiting, claim sanitisation BEFORE anything downstream, and NEVER logging the
// topic text — and returns the standard { success, data, error } envelope via ok/fail.
//
// The engine supplies every number (via runEvidencePipeline); Claude drafts the prose;
// every factual sentence is grounded to a source span before it reaches the client.

const MAX_TOPIC_LENGTH = 2000;
const MAX_QUERY_LENGTH = 2000;

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("synthesis_report.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let body: { topic?: unknown; query?: unknown; limit?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  // Topic sanitisation identical in spirit to /api/verify: strips control/invisible
  // chars, caps length, normalises whitespace — all BEFORE it reaches retrieval,
  // embeddings, the DB, or Claude.
  const sanitized = sanitizeClaimText(body.topic, {
    maxLength: MAX_TOPIC_LENGTH,
    tooLongError:
      "Topic is too long (max 2000 characters). Enter a claim or a focused research question.",
  });
  if (!sanitized.ok) {
    return fail(sanitized.error, 400);
  }
  const topic = sanitized.value;
  if (topic.length < 10) {
    return fail("Please provide a topic or claim of at least 10 characters.", 400);
  }

  // Optional search-steering query, sanitised the same way.
  let query: string | undefined;
  if (body.query !== undefined && body.query !== null && body.query !== "") {
    const sanitizedQuery = sanitizeClaimText(body.query, {
      maxLength: MAX_QUERY_LENGTH,
      tooLongError: "Query is too long (max 2000 characters).",
    });
    if (!sanitizedQuery.ok) {
      return fail(sanitizedQuery.error, 400);
    }
    query = sanitizedQuery.value;
  }

  // Optional cap on retrieved candidate sources — validated at the boundary.
  let limit: number | undefined;
  if (body.limit !== undefined) {
    const n = Number(body.limit);
    if (!Number.isInteger(n) || n < 1 || n > 20) {
      return fail("`limit` must be an integer between 1 and 20.", 400);
    }
    limit = n;
  }

  try {
    const pool = getPool();
    const report = await generateSynthesisReport(pool, { topic, query, limit });

    logEvent("synthesis_report.success", {
      latencyMs: Date.now() - start,
      usedSources: report.usedSources.length,
      droppedSentences: report.droppedSentenceCount,
      grounded: report.grounded,
      certainty: report.facts.certainty ?? "n/a",
    });

    return ok(report);
  } catch (err) {
    logEvent("synthesis_report.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/synthesis-report] failed:", err);
    return fail(
      "Something went wrong while generating the evidence review. This has been logged — please try again, or try a different topic.",
      500
    );
  }
}
