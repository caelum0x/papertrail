import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { metaAnalyze, type StudyEffectInput } from "@/lib/metaAnalysis";
import {
  eggersTest,
  trimAndFill,
  interpret,
  type StudyEffect as BiasStudyEffect,
} from "@/lib/publicationBias";
import { gradeCertainty } from "@/lib/grade";

// Public POST endpoint for META-BIAS ANALYSIS. Given >=3 ratio-measure studies
// (RR/HR/OR as point+CI or 2x2 counts), it pools them, runs Egger's regression
// test for funnel-plot asymmetry and Duval & Tweedie trim-and-fill, and reports
// the RESULTING GRADE downgrade — publication bias auto-downgrades certainty one
// step when Egger's test detects asymmetry. Fully deterministic: no LLM anywhere,
// every number reproducible from the inputs. A set that cannot be pooled (fewer
// than two usable studies) or tested (fewer than three) is reported honestly
// rather than forced. No claim or source text is logged.
export const runtime = "nodejs";

// One study: ratio measure supplied as point+CI OR the four 2x2 counts.
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

const RequestSchema = z.object({
  studies: z.array(StudySchema).min(3).max(1000),
  // Optional caller-declared judgement domains, forwarded to GRADE unchanged.
  riskOfBiasSteps: z.number().int().min(0).max(2).optional(),
  indirectnessSteps: z.number().int().min(0).max(2).optional(),
});

type MetaBiasRequest = z.infer<typeof RequestSchema>;

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
    logEvent("evidence_report.meta_bias.rate_limited", { ip });
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
      `Invalid meta-bias request — ${where}${issue?.message ?? "provide at least three ratio-measure studies."}`,
      400
    );
  }

  const { studies, riskOfBiasSteps, indirectnessSteps }: MetaBiasRequest = parsed.data;

  try {
    // 1. Pool the studies to standardize them to the log scale (yi, vi) and to
    //    derive the statistical GRADE inputs. metaAnalyze returns null when fewer
    //    than two usable studies remain — reported honestly rather than forced.
    const pooled = metaAnalyze(studies.map(toEngineStudy));
    if (!pooled) {
      logEvent("evidence_report.meta_bias.insufficient", {
        latencyMs: Date.now() - start,
        supplied: studies.length,
      });
      return ok({
        pooled: null,
        eggersTest: null,
        biasVerdict: "insufficient_studies" as const,
        trimAndFill: null,
        grade: null,
        note: "Fewer than two of the supplied studies produced a usable log-effect (each needs a positive point estimate with a widening confidence interval, or valid 2x2 counts). With under two comparable studies there is no pool, publication-bias test, or GRADE rating to compute.",
      });
    }

    // 2. Per-study log effects behind the pool: the inputs to Egger + trim-and-fill.
    const biasStudies: BiasStudyEffect[] = pooled.studies.map((s) => ({
      label: s.label,
      yi: s.yi,
      vi: s.vi,
    }));

    const egger = eggersTest(biasStudies);
    const biasVerdict = interpret(egger);
    const adjusted = trimAndFill(biasStudies);

    // 3. GRADE — pass `studyEffects` so publication bias AUTO-DOWNGRADES one step
    //    on Egger asymmetry (deterministic, behind the existing GRADE inputs).
    const grade = gradeCertainty({
      k: pooled.k,
      iSquared: pooled.heterogeneity.iSquared,
      point: pooled.random.point,
      ciLower: pooled.random.ciLower,
      ciUpper: pooled.random.ciUpper,
      ciCrossesNull: !pooled.random.significant,
      totalN: null,
      riskOfBiasSteps,
      indirectnessSteps,
      studyEffects: biasStudies,
    });

    const publicationBiasDowngrade =
      grade.downgrades.find((d) => d.domain === "publication_bias") ?? null;

    logEvent("evidence_report.meta_bias.success", {
      latencyMs: Date.now() - start,
      k: pooled.k,
      biasVerdict,
      eggerAsymmetry: egger?.asymmetry ?? null,
      k0Imputed: adjusted?.k0Imputed ?? null,
      certainty: grade.certainty,
      publicationBiasDowngraded: publicationBiasDowngrade !== null,
    });

    return ok({
      pooled: {
        measure: pooled.measure,
        k: pooled.k,
        point: pooled.random.point,
        ciLower: pooled.random.ciLower,
        ciUpper: pooled.random.ciUpper,
        reductionPercent: pooled.random.reductionPercent,
        significant: pooled.random.significant,
        iSquared: pooled.heterogeneity.iSquared,
      },
      eggersTest: egger
        ? {
            k: egger.k,
            intercept: egger.intercept,
            interceptSe: egger.interceptSe,
            slope: egger.slope,
            t: egger.t,
            df: egger.df,
            pValue: egger.pValue,
            asymmetry: egger.asymmetry,
          }
        : null,
      biasVerdict,
      trimAndFill: adjusted
        ? {
            k0Imputed: adjusted.k0Imputed,
            side: adjusted.side,
            adjustedPoint: adjusted.adjustedPoint,
            adjustedCiLower: adjusted.adjustedCiLower,
            adjustedCiUpper: adjusted.adjustedCiUpper,
          }
        : null,
      grade: {
        certainty: grade.certainty,
        startingLevel: grade.startingLevel,
        downgrades: grade.downgrades,
        rationale: grade.rationale,
        publicationBiasDowngraded: publicationBiasDowngrade !== null,
        publicationBiasReason: publicationBiasDowngrade?.reason ?? null,
      },
    });
  } catch (err) {
    logEvent("evidence_report.meta_bias.error", {
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/evidence-report/meta-bias-analysis] failed:", err);
    return fail(
      "Something went wrong while running the meta-bias analysis. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
