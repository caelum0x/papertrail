import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { checkRateLimit } from "@/lib/rateLimit";
import { sanitizeClaimText } from "@/lib/api/claimInput";
import { ok, fail } from "@/lib/api/response";
import { logEvent } from "@/lib/logger";
import { runEvidencePipeline } from "@/lib/evidencePipeline";

export const runtime = "nodejs";

// PUBLIC compute route: claim IN → full evidence report OUT, with PaperTrail finding
// its own primary sources. Mirrors /api/verify's public-route hardening — nodejs
// runtime, IP rate limiting, claim sanitisation before anything downstream, and NEVER
// logging the claim text — but returns the standard { success, data, error } envelope
// via ok/fail. All numeric work is deterministic; no LLM sits in the numeric loop.

const MAX_CLAIM_LENGTH = 2000;
const MAX_QUERY_LENGTH = 2000;

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("evidence_pipeline.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let body: { claim?: unknown; query?: unknown; limit?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  // Claim sanitisation identical in spirit to /api/verify: strips control/invisible
  // chars, caps length, and normalises whitespace — all BEFORE the claim reaches
  // retrieval, embeddings, or the DB.
  const sanitized = sanitizeClaimText(body.claim, {
    maxLength: MAX_CLAIM_LENGTH,
    tooLongError:
      "Claim is too long (max 2000 characters). Paste a single sentence or short passage.",
  });
  if (!sanitized.ok) {
    return fail(sanitized.error, 400);
  }
  const claim = sanitized.value;
  if (claim.length < 10) {
    return fail("Please provide a claim of at least 10 characters.", 400);
  }

  // Optional search-steering query, sanitised the same way. Absent/empty means the
  // pipeline searches on the claim text itself.
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

  // Optional limit on retrieved candidate sources. Reject non-integer / out-of-range
  // input at the boundary rather than silently coercing it.
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
    const result = await runEvidencePipeline(pool, { claim, query, limit });

    logEvent("evidence_pipeline.success", {
      latencyMs: Date.now() - start,
      usedSources: result.usedSources.length,
      skipped: result.skipped.length,
      reportOk: result.report.ok,
    });

    return ok(result);
  } catch (err) {
    logEvent("evidence_pipeline.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/evidence-pipeline] failed:", err);
    return fail(
      "Something went wrong while building the evidence report. This has been logged — please try again, or try a different claim.",
      500
    );
  }
}
