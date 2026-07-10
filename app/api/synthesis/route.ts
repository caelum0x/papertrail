import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { SynthesisRequestSchema, type SynthesisStudyInput } from "@/lib/schemas";
import { metaAnalyze, type StudyEffectInput } from "@/lib/metaAnalysis";
import { verifyAgainstSynthesis } from "@/lib/synthesisVerification";

// Public evidence-synthesis endpoint. Given a claim and >=2 study effect
// estimates, it pools them with the deterministic meta-analysis engine and
// returns a verdict comparing the claim's magnitude to the pooled effect.
// No LLM is anywhere in this path — every number is reproducible from the input.
export const runtime = "nodejs";

// Map a snake_case request study to the engine's camelCase StudyEffectInput.
// The request carries either point+ci_lower+ci_upper or the four 2x2 counts;
// we forward both shapes and let metaAnalyze standardize/skip as appropriate.
function toEngineInput(study: SynthesisStudyInput): StudyEffectInput {
  return {
    label: study.label,
    measure: study.measure,
    point: study.point ?? null,
    ciLower: study.ci_lower ?? null,
    ciUpper: study.ci_upper ?? null,
    ciPct: study.ci_pct ?? null,
    events1: study.events1 ?? null,
    total1: study.total1 ?? null,
    events2: study.events2 ?? null,
    total2: study.total2 ?? null,
  };
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("synthesis.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  // Validate at the boundary — never trust the raw request. Surface the first
  // validation issue as a user-facing message rather than a raw Zod dump.
  const parsed = SynthesisRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(`Invalid synthesis request — ${where}${issue?.message ?? "check your inputs."}`, 400);
  }

  const { claim, studies } = parsed.data;

  try {
    const inputs = studies.map(toEngineInput);

    // Pool directly for the numeric result (fixed/random/heterogeneity/PI),
    // and run the claim-vs-pool comparison. verifyAgainstSynthesis consumes
    // registered TrialResultAnalysis shapes, so we adapt each study into a
    // single-analysis source whose primary ratio result is the supplied effect.
    const pooled = metaAnalyze(inputs);
    if (!pooled) {
      logEvent("synthesis.insufficient", { latencyMs: Date.now() - start, k: studies.length });
      return ok({
        pooled: null,
        verdict: {
          verdict: "insufficient_evidence",
          rationale:
            "Fewer than two of the supplied studies produced a usable log-effect (check that each has a positive point estimate and a widening confidence interval, or valid 2x2 counts).",
          claimedReductionPercent: null,
          pooledReductionPercent: null,
          measure: null,
        },
      });
    }

    // Adapt each pooled study (already standardized to a positive point + CI on
    // the ratio scale, including any count-derived effects) into a single-primary-
    // analysis "source" so verifyAgainstSynthesis can compare the claim against the
    // pool. It re-derives the pool from these same effects, so the verdict is
    // consistent with the `pooled` object returned above (both trace to the same
    // standardized studies; only 3dp rounding differs, which is immaterial).
    const verdict = verifyAgainstSynthesis(
      claim,
      pooled.studies.map((s) => ({
        label: s.label,
        analyses: [
          {
            outcomeTitle: s.label,
            outcomeType: "PRIMARY",
            paramType: s.measure,
            paramValue: s.point,
            ciPct: 95,
            ciLower: s.ciLower,
            ciUpper: s.ciUpper,
            pValue: null,
            method: null,
          },
        ],
      }))
    );

    logEvent("synthesis.success", {
      latencyMs: Date.now() - start,
      k: pooled.k,
      measure: pooled.measure,
      verdict: verdict.verdict,
      iSquared: pooled.heterogeneity.iSquared,
      skipped: pooled.skipped.length,
    });

    return ok({
      pooled,
      verdict: {
        verdict: verdict.verdict,
        rationale: verdict.rationale,
        claimedReductionPercent: verdict.claimedReductionPercent,
        pooledReductionPercent: verdict.pooledReductionPercent,
        measure: verdict.measure,
      },
    });
  } catch (err) {
    logEvent("synthesis.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/synthesis] failed:", err);
    return fail(
      "Something went wrong while pooling these studies. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
