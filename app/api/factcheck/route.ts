import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { FactCheckRequestSchema } from "@/lib/factcheck/schemas";
import { runFactCheck } from "@/lib/factcheck/pipeline";

// Public POST endpoint for the multi-step fact-verification pipeline ported from
// Loki / OpenFactVerification. Given a block of natural-language text, it runs
// decompose -> checkworthy -> query-gen -> retrieve (over OUR cached sources) ->
// verify (grounded to a real source span) -> aggregate, and returns per-claim
// verdicts with grounded evidence plus an overall factuality summary.
//
// Never logs the submitted text (may be unpublished research content) — only
// metadata needed to debug latency/failures.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("factcheck.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = FactCheckRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid fact-check request — ${where}${issue?.message ?? "check your input."}`,
      400
    );
  }

  try {
    const result = await runFactCheck(parsed.data.text);

    logEvent("factcheck.success", {
      latencyMs: Date.now() - start,
      numClaims: result.summary.num_claims,
      numCheckworthy: result.summary.num_checkworthy,
      numVerified: result.summary.num_verified,
      factuality: result.summary.factuality,
    });

    return ok(result);
  } catch (err) {
    logEvent("factcheck.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/factcheck] failed:", err);
    return fail(
      "Something went wrong while fact-checking. This has been logged — please try again shortly.",
      500
    );
  }
}
