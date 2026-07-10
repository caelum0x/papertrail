import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import {
  metaRegression,
  MetaRegressionRequestSchema,
  type MetaRegressionPoint,
} from "@/lib/metaRegression";

// Public POST endpoint for the deterministic meta-regression engine. Given a set of
// study-level effect estimates (log effect yi + variance vi) and a study-level
// moderator x (dose, baseline risk, publication year, ...), it fits yi ~ b0 + b1*x
// by inverse-variance weighted least squares (mixed-effects, with a DerSimonian–
// Laird residual tau^2) to explain heterogeneity. A significant slope means the
// moderator drives the effect. NO LLM is invoked here — every number returned is a
// pure closed-form computation from lib/metaRegression. Never logs the claim text.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("meta_regression.rate_limited", { ip });
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
  const parsed = MetaRegressionRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid meta-regression request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  const { points, moderator, residualHeterogeneity } = parsed.data;

  try {
    const enginePoints: MetaRegressionPoint[] = points.map((p) => ({
      label: p.label,
      yi: p.yi,
      vi: p.vi,
      x: p.x,
    }));

    const result = metaRegression(enginePoints, { residualHeterogeneity });

    // Null when fewer than three studies with >= 2 distinct moderator values —
    // honestly report that the regression could not be run rather than forcing a
    // spurious slope.
    if (result === null) {
      logEvent("meta_regression.insufficient", {
        latencyMs: Date.now() - start,
        points: points.length,
      });
      return fail(
        "Meta-regression needs at least 3 studies with 2 or more distinct moderator values.",
        422
      );
    }

    logEvent("meta_regression.success", {
      latencyMs: Date.now() - start,
      k: result.k,
      slopeSignificant: result.slopePValue < 0.05,
      residualDf: result.residualDf,
    });

    // predict() is a closure and is not JSON-serializable; expose the fitted line
    // via coefficients and precomputed predictions at each study's moderator value.
    return ok({
      moderator: moderator ?? null,
      k: result.k,
      intercept: result.intercept,
      slope: result.slope,
      interceptSe: result.interceptSe,
      slopeSe: result.slopeSe,
      slopeZ: result.slopeZ,
      slopePValue: result.slopePValue,
      slopeSignificant: result.slopePValue < 0.05,
      residualQ: result.residualQ,
      residualDf: result.residualDf,
      residualPValue: result.residualPValue,
      tauSquared: result.tauSquared,
      rSquaredAnalog: result.rSquaredAnalog,
      fittedLine: points.map((p) => ({
        label: p.label,
        x: p.x,
        observed: p.yi,
        fitted: result.predict(p.x),
      })),
    });
  } catch (err) {
    logEvent("meta_regression.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/meta-regression] failed:", err);
    return fail(
      "Something went wrong while running this meta-regression. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
