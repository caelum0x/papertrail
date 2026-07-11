import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { analyzeFragility, FragilityRequestSchema } from "@/lib/evidenceFragility";

// Public POST endpoint for VERDICT-FRAGILITY ANALYSIS. Two modes, dispatched by
// `mode`:
//   { mode: "table", a, b, c, d } — the Walsh Fragility Index of a single 2x2
//     table: the minimum number of event reassignments that flips the two-sided
//     Fisher exact significance at p = 0.05.
//   { mode: "meta", studies[], informationSize? } — leave-one-out robustness of a
//     pooled random-effects verdict, plus (optionally) whether enough information
//     has accrued relative to the required information size.
//
// The verdict is decided entirely by deterministic math — Fisher's exact test,
// meta-analytic pooling and the required information size formula. NO LLM is in
// the loop, and nothing is fabricated: an unpoolable or non-significant input
// yields an honest verdict rather than a forced one.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("evidence.fragility.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = FragilityRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid fragility request — ${where}${issue?.message ?? "provide a 2x2 { a, b, c, d } or { studies[] }."}`,
      400
    );
  }

  try {
    const result = analyzeFragility(parsed.data);
    logEvent("evidence.fragility.success", {
      latencyMs: Date.now() - start,
      mode: parsed.data.mode,
      verdict: result.verdict,
      studyCount: parsed.data.mode === "meta" ? parsed.data.studies.length : undefined,
    });
    return ok(result);
  } catch (err) {
    logEvent("evidence.fragility.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/evidence/fragility] failed:", err);
    return fail(
      "Something went wrong while running the fragility analysis. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
