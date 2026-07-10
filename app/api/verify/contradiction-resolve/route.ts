import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { resolveContradiction, claudeFeatureTagger } from "@/lib/contradiction/atlas";
import { claudeSourceScorer } from "@/lib/scieval/valsci";
import { ContradictionResolveRequestSchema } from "@/lib/contradiction/schemas";

// Public POST endpoint for the QUANTITATIVE CONTRADICTION ATLAS. Given { claim, sources[] }
// it scores every source against the claim with the deterministic Valsci port, and when the
// set verdict is "mixed" (sources disagree), routes both sides to a DETERMINISTIC conflict
// explainer that attributes the reversal to a study-design dimension — population, dose,
// tissue, or follow-up.
//
// MOAT: the only LLM steps are per-source relevance/support scoring (Valsci) and per-source
// candidate design-feature tagging; BOTH produce verbatim quotes grounded to the source, and
// the resolution category, winning dimension, and every number are decided by deterministic
// rules — no LLM in the verdict/attribution path. An unattributable conflict is reported
// honestly as "unattributed_conflict" rather than forced onto a dimension. Source text is
// never logged.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("verify.contradiction_resolve.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = ContradictionResolveRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid contradiction-resolve request — ${where}${
        issue?.message ?? "provide a claim plus at least two sources."
      }`,
      400
    );
  }

  try {
    const result = await resolveContradiction(parsed.data, {
      score: { scoreSource: claudeSourceScorer },
      tagFeatures: claudeFeatureTagger,
      // Mechanism belief is left unset here: it is an OPTIONAL deterministic weight on
      // sides and requires an extra Claude extraction per source. The atlas degrades to
      // belief 0 (no weighting) when omitted, keeping the route cost-bounded; the
      // attribution still rests on grounded design-feature differences.
    });

    logEvent("verify.contradiction_resolve.success", {
      latencyMs: Date.now() - start,
      claimVerdict: result.claim_verdict,
      resolution: result.resolution_category,
      supportingCount: result.supporting_count,
      refutingCount: result.refuting_count,
      primaryDimension: result.primary_hypothesis?.dimension ?? null,
      consideredCount: result.considered_count,
      featureGroundingDropped: result.feature_grounding_dropped_count,
    });
    return ok(result);
  } catch (err) {
    logEvent("verify.contradiction_resolve.error", {
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/verify/contradiction-resolve] failed:", err);
    return fail(
      "Something went wrong while resolving the contradiction. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
