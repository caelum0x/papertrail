import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { crossCheckMeta } from "@/lib/engines/metaCrossCheck";
import type { StudyEffectInput } from "@/lib/metaAnalysis";

// Public POST endpoint for the meta-analysis PRODUCTION ORACLE. It runs our
// deterministic TS meta-analysis (lib/metaAnalysis.ts) and, when the PyMARE
// backend is enabled (PYMARE_ENABLED, opt-in), an INDEPENDENT PyMARE reference
// pool over the identical study-level log effects, then reports whether the two
// random-effects estimates agree. When PyMARE is off or its subprocess rejects,
// the reference is null and the TS result stands unchanged — the endpoint always
// returns our engine's answer, never depending on the reference being present.
// NO LLM is invoked; every number is a pure closed-form computation. Never logs
// study values.
export const runtime = "nodejs";

const RatioMeasureSchema = z.enum(["RR", "HR", "OR"]);

// One study: EITHER a point estimate + confidence interval OR raw 2x2 counts —
// exactly the shape lib/metaAnalysis.ts#StudyEffectInput accepts. We validate the
// envelope here and let the engine standardize/skip individual studies.
const StudyInputSchema = z.object({
  label: z.string().min(1, "each study needs a non-empty label").max(200),
  measure: RatioMeasureSchema,
  point: z.number().finite().positive().nullish(),
  ciLower: z.number().finite().positive().nullish(),
  ciUpper: z.number().finite().positive().nullish(),
  ciPct: z.number().finite().gt(0).lt(100).nullish(),
  events1: z.number().finite().nonnegative().nullish(),
  total1: z.number().finite().nonnegative().nullish(),
  events2: z.number().finite().nonnegative().nullish(),
  total2: z.number().finite().nonnegative().nullish(),
});

const MetaCrossCheckRequestSchema = z.object({
  studies: z
    .array(StudyInputSchema)
    .min(2, "meta-analysis needs at least two studies to pool")
    .max(200, "too many studies in one request"),
});

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("meta_crosscheck.rate_limited", { ip });
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
  const parsed = MetaCrossCheckRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid meta cross-check request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  const { studies } = parsed.data;

  try {
    const engineInputs: StudyEffectInput[] = studies.map((s) => ({
      label: s.label,
      measure: s.measure,
      point: s.point ?? null,
      ciLower: s.ciLower ?? null,
      ciUpper: s.ciUpper ?? null,
      ciPct: s.ciPct ?? null,
      events1: s.events1 ?? null,
      total1: s.total1 ?? null,
      events2: s.events2 ?? null,
      total2: s.total2 ?? null,
    }));

    const result = await crossCheckMeta(engineInputs);

    // Null `ours` means fewer than two usable studies remained after
    // standardization — report honestly rather than forcing a pool of one.
    if (result.ours === null) {
      logEvent("meta_crosscheck.insufficient", {
        latencyMs: Date.now() - start,
        studies: studies.length,
      });
      return fail(
        "Meta cross-check needs at least two usable studies (each with a positive point+CI or all four valid 2x2 counts).",
        422
      );
    }

    logEvent("meta_crosscheck.success", {
      latencyMs: Date.now() - start,
      k: result.ours.k,
      referenced: result.reference !== null,
      agree: result.agree,
    });

    return ok(result);
  } catch (err) {
    logEvent("meta_crosscheck.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/meta-crosscheck] failed:", err);
    return fail(
      "Something went wrong while running this meta cross-check. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
