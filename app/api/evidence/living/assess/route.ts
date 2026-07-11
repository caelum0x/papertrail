import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { assessLivingEvidence, assessRequestSchema } from "@/lib/livingEvidence/monitor";

// Public POST endpoint for LIVING-EVIDENCE ASSESSMENT. Given a time-ordered body of
// { studies[] } plus a single { candidate } new study, it deterministically
// re-pools the accumulating evidence (cumulative meta-analysis) and returns:
//   - the running pooled estimate at each accrual step (for a cumulative timeline),
//   - when the pooled effect first reached significance,
//   - a FLIP verdict: would_flip / strengthens / weakens / no_change /
//     insufficient_evidence — decided purely by inverse-variance pooling math.
//
// No LLM is in the numeric loop. An unpoolable body (fewer than two usable studies
// even after the candidate) returns an honest insufficient_evidence rather than a
// forced answer.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("evidence.living.assess.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = assessRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid living-evidence request — ${where}${issue?.message ?? "provide studies[] and a candidate."}`,
      400
    );
  }

  try {
    const result = assessLivingEvidence(parsed.data);
    logEvent("evidence.living.assess.success", {
      latencyMs: Date.now() - start,
      verdict: result.verdict,
      studyCount: parsed.data.studies.length,
      usableCount: result.cumulative.usableCount,
    });
    return ok(result);
  } catch (err) {
    logEvent("evidence.living.assess.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/evidence/living/assess] failed:", err);
    return fail(
      "Something went wrong while assessing the living evidence. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
