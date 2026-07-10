import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import {
  doseResponseTrend,
  DoseResponseRequestSchema,
  type DosePoint,
} from "@/lib/doseResponse";

// Public POST endpoint for the deterministic dose-response engine. Given a set of
// dose-stratified effect estimates (each vs a COMMON reference: log effect yi +
// variance vi at a dose level), it fits the linear trend yi ~ b*dose by
// inverse-variance weighted least squares and tests the slope against zero. A
// significant slope means "more drug → more effect" — a dose-response the
// single-comparison checkers cannot detect. NO LLM is invoked here — every number
// returned is a pure closed-form computation from lib/doseResponse. Never logs the
// claim text.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("dose_response.rate_limited", { ip });
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
  const parsed = DoseResponseRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid dose-response request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  const { points, doseUnit } = parsed.data;

  try {
    const enginePoints: DosePoint[] = points.map((p) => ({
      label: p.label,
      dose: p.dose,
      yi: p.yi,
      vi: p.vi,
    }));

    const result = doseResponseTrend(enginePoints);

    // Null when fewer than three usable points or fewer than two distinct doses —
    // honestly report that the trend could not be fit rather than forcing a
    // spurious slope.
    if (result === null) {
      logEvent("dose_response.insufficient", {
        latencyMs: Date.now() - start,
        points: points.length,
      });
      return fail(
        "Dose-response needs at least 3 points with 2 or more distinct dose levels.",
        422
      );
    }

    logEvent("dose_response.success", {
      latencyMs: Date.now() - start,
      k: result.k,
      trend: result.trend,
      slopeSignificant: result.slopePValue < 0.05,
      residualDf: result.residualDf,
    });

    return ok({
      doseUnit: doseUnit ?? null,
      k: result.k,
      distinctDoses: result.distinctDoses,
      slopePerUnitDose: result.slopePerUnitDose,
      slopeSe: result.slopeSe,
      slopeZ: result.slopeZ,
      slopePValue: result.slopePValue,
      slopeSignificant: result.slopePValue < 0.05,
      intercept: result.intercept,
      trend: result.trend,
      perDoseEffect: result.perDoseEffect,
      residualQ: result.residualQ,
      residualDf: result.residualDf,
      residualPValue: result.residualPValue,
    });
  } catch (err) {
    logEvent("dose_response.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/dose-response] failed:", err);
    return fail(
      "Something went wrong while fitting this dose-response trend. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
