import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import {
  poolContinuous,
  ContinuousMetaRequestSchema,
  type ContinuousStudyInput,
} from "@/lib/continuousMeta";

// Public POST endpoint for the deterministic CONTINUOUS-outcome meta-analysis
// engine. Given a set of two-arm studies reporting continuous endpoints (mean,
// SD, n per arm — e.g. blood-pressure change or pain score), it pools them on the
// mean-difference (MD) or Hedges'-g (SMD) scale into fixed-effect and random-
// effects summaries with Q / df / I² / tau² heterogeneity — the counterpart to
// /api/meta-regression's ratio pooling, around a null of 0 rather than 1. NO LLM
// is invoked; every number is a pure closed-form computation from lib/continuousMeta.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("continuous_meta.rate_limited", { ip });
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
  const parsed = ContinuousMetaRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid continuous meta-analysis request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  const { studies, measure } = parsed.data;

  try {
    const engineInputs: ContinuousStudyInput[] = studies.map((s) => ({
      label: s.label,
      meanT: s.meanT,
      sdT: s.sdT,
      nT: s.nT,
      meanC: s.meanC,
      sdC: s.sdC,
      nC: s.nC,
    }));

    const result = poolContinuous(engineInputs, { measure });

    // Null when fewer than two usable studies remain — report honestly rather
    // than forcing a low-confidence pool of one study.
    if (result === null) {
      logEvent("continuous_meta.insufficient", {
        latencyMs: Date.now() - start,
        studies: studies.length,
        measure,
      });
      return fail(
        "Continuous meta-analysis needs at least two usable studies (each with positive arm SDs and at least two participants per arm).",
        422
      );
    }

    logEvent("continuous_meta.success", {
      latencyMs: Date.now() - start,
      measure,
      k: result.k,
      iSquared: result.heterogeneity.iSquared,
      significant: result.random.significant,
      skipped: result.skipped.length,
    });

    return ok(result);
  } catch (err) {
    logEvent("continuous_meta.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/continuous-meta] failed:", err);
    return fail(
      "Something went wrong while running this continuous meta-analysis. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
