import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import type { StudyEffectInput } from "@/lib/metaAnalysis";
import { bayesianMetaAnalyze, type NormalPrior } from "@/lib/metaBayesian";

// Public POST endpoint for BAYESIAN RANDOM-EFFECTS META-ANALYSIS. Given >=2
// ratio-measure studies (RR/HR/OR as point+CI or 2x2 counts), it standardizes
// them to the log scale, holds tau^2 at the DerSimonian–Laird point estimate,
// and returns — in closed form (conjugate normal-normal, no MCMC) — the
// POSTERIOR mean + credible interval for the overall effect and a
// POSTERIOR-PREDICTIVE interval for a new study's true effect. Fully
// deterministic: no LLM anywhere, every number reproducible from the inputs. A
// set that cannot be pooled (fewer than two usable studies) is reported honestly
// rather than forced. No claim or source text is logged.
export const runtime = "nodejs";

// One study: ratio measure supplied as point+CI OR the four 2x2 counts. Mirrors
// the schema used by /api/evidence-report/meta-bias-analysis so callers can send
// the identical study payload to either endpoint.
const StudySchema = z.object({
  label: z.string().min(1).max(200),
  measure: z.enum(["RR", "HR", "OR"]),
  point: z.number().positive().nullable().optional(),
  ci_lower: z.number().positive().nullable().optional(),
  ci_upper: z.number().positive().nullable().optional(),
  ci_pct: z.number().min(50).max(99.99).nullable().optional(),
  events1: z.number().int().min(0).nullable().optional(),
  total1: z.number().int().min(0).nullable().optional(),
  events2: z.number().int().min(0).nullable().optional(),
  total2: z.number().int().min(0).nullable().optional(),
});

// Optional proper Normal prior on the overall mean, on the LOG scale
// (mean 0 = null effect). Omit for the default flat prior.
const PriorSchema = z.object({
  mean: z.number().finite(),
  variance: z.number().positive().finite(),
});

const RequestSchema = z.object({
  studies: z.array(StudySchema).min(2).max(1000),
  credible_pct: z.number().min(50).max(99.99).optional(),
  prior: PriorSchema.optional(),
  // Optional override of the fixed tau^2 point estimate (log scale). Omit to use
  // the DerSimonian–Laird estimate from the pooling engine.
  tau_squared: z.number().min(0).finite().optional(),
});

type BayesianRequest = z.infer<typeof RequestSchema>;

function toEngineStudy(s: z.infer<typeof StudySchema>): StudyEffectInput {
  return {
    label: s.label,
    measure: s.measure,
    point: s.point ?? null,
    ciLower: s.ci_lower ?? null,
    ciUpper: s.ci_upper ?? null,
    ciPct: s.ci_pct ?? null,
    events1: s.events1 ?? null,
    total1: s.total1 ?? null,
    events2: s.events2 ?? null,
    total2: s.total2 ?? null,
  };
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("meta.bayesian.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid Bayesian meta request — ${where}${issue?.message ?? "provide at least two ratio-measure studies."}`,
      400
    );
  }

  const { studies, credible_pct, prior, tau_squared }: BayesianRequest = parsed.data;
  const enginePrior: NormalPrior | undefined = prior
    ? { mean: prior.mean, variance: prior.variance }
    : undefined;

  try {
    const result = bayesianMetaAnalyze(studies.map(toEngineStudy), {
      crediblePct: credible_pct,
      prior: enginePrior,
      tauSquared: tau_squared,
    });

    if (!result) {
      logEvent("meta.bayesian.insufficient", {
        latencyMs: Date.now() - start,
        supplied: studies.length,
      });
      return ok({
        posterior: null,
        note: "Fewer than two of the supplied studies produced a usable log-effect (each needs a positive point estimate with a widening confidence interval, or valid 2x2 counts). With under two comparable studies there is no pool to place a Bayesian posterior over.",
      });
    }

    logEvent("meta.bayesian.success", {
      latencyMs: Date.now() - start,
      k: result.k,
      measure: result.measure,
      tauSource: result.tauSource,
      priorType: result.prior.type,
    });

    return ok({
      posterior: {
        measure: result.measure,
        k: result.k,
        posteriorMean: result.posteriorMean,
        posteriorMeanLog: result.posteriorMeanLog,
        posteriorVar: result.posteriorVar,
        credible: result.credible,
        predictive: result.predictive,
        tauSquared: result.tauSquared,
        tauSource: result.tauSource,
        prior: result.prior,
        crediblePct: result.crediblePct,
        probBelowNull: result.probBelowNull,
      },
      skipped: result.skipped,
      method:
        "Conjugate normal-normal random-effects Bayesian meta-analysis (closed form, no MCMC). tau^2 fixed at the DerSimonian–Laird estimate; posterior mean is the inverse-variance weighted mean under a flat prior (precision-updated under a proper Normal prior). The posterior-predictive interval adds tau^2 to the posterior variance and uses a Normal quantile. See lib/metaBayesian.ts for the documented approximations.",
    });
  } catch (err) {
    logEvent("meta.bayesian.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/meta/bayesian] failed:", err);
    return fail(
      "Something went wrong while running the Bayesian meta-analysis. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
