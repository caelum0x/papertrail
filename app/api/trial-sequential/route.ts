import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import {
  requiredInformationSize,
  obrienFlemingBoundary,
  trialSequentialVerdict,
  TrialSequentialRequestSchema,
} from "@/lib/trialSequential";

// Public POST endpoint for the deterministic TRIAL SEQUENTIAL ANALYSIS engine.
// Given accrued evidence, it answers the question a generic significance checker
// cannot: is the pooled evidence CONCLUSIVE, or is more data still needed? Three
// modes:
//   mode: "ris"      -> Required Information Size for a definitive body of evidence
//   mode: "boundary" -> O'Brien–Fleming alpha-spending Z boundary at fraction t
//   mode: "verdict"  -> conclusive_benefit | conclusive_no_effect | insufficient
//
// NO LLM is invoked; every number is a pure closed-form computation reusing
// lib/stats/distributions quantiles. Same inputs → same verdict, always.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("trial_sequential.rate_limited", { ip });
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
  const parsed = TrialSequentialRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid trial-sequential request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  try {
    const data = parsed.data;

    if (data.mode === "ris") {
      const result = requiredInformationSize(data);
      logEvent("trial_sequential.ris", {
        latencyMs: Date.now() - start,
        risTotal: result.risTotal,
        diversityAdjusted: result.diversityAdjusted,
      });
      return ok({ mode: "ris" as const, ...result });
    }

    if (data.mode === "boundary") {
      const result = obrienFlemingBoundary(data);
      logEvent("trial_sequential.boundary", {
        latencyMs: Date.now() - start,
        informationFraction: result.informationFraction,
      });
      return ok({ mode: "boundary" as const, ...result });
    }

    // mode === "verdict"
    const result = trialSequentialVerdict(data);
    logEvent("trial_sequential.verdict", {
      latencyMs: Date.now() - start,
      verdict: result.verdict,
      informationFraction: result.informationFraction,
    });
    return ok({ mode: "verdict" as const, ...result });
  } catch (err) {
    logEvent("trial_sequential.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/trial-sequential] failed:", err);
    return fail(
      "Something went wrong while running this trial sequential analysis. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
