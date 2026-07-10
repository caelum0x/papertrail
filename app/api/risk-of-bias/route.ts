import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { assessRiskOfBias, riskOfBiasInputSchema } from "@/lib/riskOfBias";

// Public POST endpoint for the deterministic risk-of-bias (RoB) engine. Given a
// single randomized trial described by explicit, reviewer-answerable facts
// (randomization, allocation concealment, blinding, attrition/ITT, selective
// reporting, plus pragmatic flags), it returns per-domain Cochrane RoB 2 style
// judgements, an overall judgement, and the GRADE downgrade step count that feeds
// gradeCertainty(...).riskOfBiasSteps. NO LLM is invoked — every judgement is a
// pure rule from lib/riskOfBias. Never logs any trial-identifying text.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("risk_of_bias.rate_limited", { ip });
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
  const parsed = riskOfBiasInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid risk-of-bias request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  try {
    const result = assessRiskOfBias(parsed.data);

    logEvent("risk_of_bias.success", {
      latencyMs: Date.now() - start,
      overall: result.overall,
      gradeSteps: result.gradeSteps,
    });

    return ok(result);
  } catch (err) {
    logEvent("risk_of_bias.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/risk-of-bias] failed:", err);
    return fail(
      "Something went wrong while assessing risk of bias. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
