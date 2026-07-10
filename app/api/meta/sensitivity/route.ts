import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import type { StudyEffectInput } from "@/lib/metaAnalysis";
import { leaveOneOutSensitivity } from "@/lib/metaSensitivity";

// Public POST endpoint for LEAVE-ONE-OUT SENSITIVITY ANALYSIS. Given >=3
// ratio-measure studies (RR/HR/OR as point+CI or 2x2 counts), it pools them,
// then re-pools k times dropping each study in turn, and reports the resulting
// swing in the random-effects summary, whether any single study's removal flips
// statistical significance, and which studies are influential. Fully
// deterministic: no LLM anywhere, every number reproducible from the inputs. A
// set with fewer than three usable studies (each leave-one-out pool needs two
// remaining) is reported honestly rather than forced. No claim or source text is
// logged.
export const runtime = "nodejs";

// One study: ratio measure supplied as point+CI OR the four 2x2 counts. Mirrors
// the schema used by the other /api/meta endpoints so callers can send the
// identical study payload to any of them.
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
});

type SensitivityRequest = z.infer<typeof RequestSchema>;

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
    logEvent("meta.sensitivity.rate_limited", { ip });
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
      `Invalid sensitivity request — ${where}${issue?.message ?? "provide at least three ratio-measure studies."}`,
      400
    );
  }

  const { studies }: SensitivityRequest = parsed.data;

  try {
    const result = leaveOneOutSensitivity(studies.map(toEngineStudy));

    if (!result) {
      logEvent("meta.sensitivity.insufficient", {
        latencyMs: Date.now() - start,
        supplied: studies.length,
      });
      return ok({
        sensitivity: null,
        note: "Fewer than three of the supplied studies produced a usable log-effect. A leave-one-out sensitivity analysis needs at least three usable studies so that each re-pool (after dropping one) still contains two — the minimum for a meta-analysis.",
      });
    }

    logEvent("meta.sensitivity.success", {
      latencyMs: Date.now() - start,
      k: result.k,
      measure: result.measure,
      anyFlipsSignificance: result.anyFlipsSignificance,
      influentialCount: result.influentialLabels.length,
    });

    return ok({
      sensitivity: {
        measure: result.measure,
        k: result.k,
        overall: {
          point: result.overallPoint,
          logPoint: result.overallLogPoint,
          ciLower: result.overallCiLower,
          ciUpper: result.overallCiUpper,
          significant: result.overallSignificant,
          iSquared: result.overallISquared,
        },
        leaveOneOut: result.leaveOneOut,
        maxSwing: result.maxSwing,
        maxSwingLabel: result.maxSwingLabel,
        maxLogSwing: result.maxLogSwing,
        influentialLabels: result.influentialLabels,
        anyFlipsSignificance: result.anyFlipsSignificance,
      },
      skipped: result.skipped,
      method:
        "Leave-one-out sensitivity: the random-effects (DerSimonian–Laird) pool is recomputed k times, dropping one study each time. A study is flagged influential when its removal shifts the pooled log effect by >= 0.10 or flips statistical significance (the 95% CI crossing the null). Fully deterministic; see lib/metaSensitivity.ts.",
    });
  } catch (err) {
    logEvent("meta.sensitivity.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/meta/sensitivity] failed:", err);
    return fail(
      "Something went wrong while running the sensitivity analysis. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
