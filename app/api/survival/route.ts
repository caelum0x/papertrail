import { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { ok, fail } from "@/lib/api/response";
import {
  SurvivalRequestSchema,
  medianSurvivalRatio,
  absoluteRiskAtTimepoint,
  verifyAgainstSurvival,
  type SurvivalData,
} from "@/lib/survival";

// Public POST endpoint for the deterministic survival / time-to-event engine.
// Node runtime (in-memory rate limiter + shared numeric libs), rate-limited per IP,
// validates the body with SurvivalRequestSchema, and returns the standard
// { success, data, error } envelope. NO LLM is invoked here — every number returned
// is a pure closed-form computation from lib/survival. Never logs the claim text.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("survival.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = SurvivalRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request body.";
    logEvent("survival.validation_error", { issue: message });
    return fail(message, 400);
  }

  const {
    claim,
    hazardRatio,
    hrCiLower,
    hrCiUpper,
    medianTreatment,
    medianControl,
    survivalControl,
    survivalTreatment,
    timepoint,
  } = parsed.data;

  try {
    // Deterministic median ratio when both arms' medians are supplied.
    const medianRatio =
      medianTreatment != null && medianControl != null
        ? medianSurvivalRatio(medianTreatment, medianControl)
        : null;

    // Deterministic absolute risk reduction / NNT at a landmark timepoint when both
    // Kaplan–Meier survival probabilities are supplied.
    const absoluteRisk =
      survivalControl != null && survivalTreatment != null
        ? absoluteRiskAtTimepoint(survivalControl, survivalTreatment, timepoint ?? null)
        : null;

    // The reported HR + CI drive the reconciler here. Callers that need to derive an
    // HR from a raw logrank observed/expected/variance triple use
    // `hazardRatioFromLogrank` from lib/survival before hitting this route.
    const data: SurvivalData = {
      hazardRatio: hazardRatio ?? null,
      hrCiLower: hrCiLower ?? null,
      hrCiUpper: hrCiUpper ?? null,
      medianTreatment: medianTreatment ?? null,
      medianControl: medianControl ?? null,
    };

    const reconciliation = verifyAgainstSurvival(claim, data);

    logEvent("survival.success", {
      latencyMs: Date.now() - start,
      verdict: reconciliation.verdict,
      hasHr: hazardRatio != null,
      hasMedians: medianRatio !== null,
      hasKm: absoluteRisk !== null,
    });

    return ok({
      reconciliation,
      median_ratio: medianRatio,
      absolute_risk: absoluteRisk,
    });
  } catch (err) {
    logEvent("survival.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/survival] failed:", err);
    return fail(
      "Something went wrong while analyzing this survival claim. This has been logged — please try again.",
      500
    );
  }
}
