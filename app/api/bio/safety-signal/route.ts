import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { getPool } from "@/lib/db";
import { cachedBio } from "@/lib/bio/cache";
import {
  assessSafetySignal,
  disproportionality,
  SafetySignalRequestSchema,
  Faers2x2Schema,
} from "@/lib/bio/pharmacovigilance";

function optionalPool() {
  try {
    return getPool();
  } catch {
    return undefined;
  }
}

// Public POST endpoint for PHARMACOVIGILANCE SIGNAL DETECTION on FDA FAERS.
// Two modes, both fully DETERMINISTIC (no LLM in the numeric path):
//   1. { drug, event } — fetches the drug–event 2x2 from openFDA and runs
//      disproportionality (PRR, ROR, chi-square, Information Component).
//   2. { a, b, c, d } — a pre-assembled 2x2, so a published contingency table can
//      be reproduced offline with zero network dependency.
// On upstream failure (mode 1) the engine returns an honest null rather than a
// fabricated signal. Every statistic is computed from standard formulas.
export const runtime = "nodejs";

// Accept either shape; the 2x2 form takes precedence when a/b/c/d are present.
const BodySchema = z.union([Faers2x2Schema, SafetySignalRequestSchema]);

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("bio.safety_signal.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid safety-signal request — ${where}${issue?.message ?? "provide either {drug,event} or a {a,b,c,d} 2x2."}`,
      400
    );
  }

  try {
    // Deterministic 2x2 path (no network): reproduce a published table exactly.
    if ("a" in parsed.data) {
      const result = disproportionality(parsed.data);
      if (!result) {
        return fail("The 2x2 table is degenerate (a zero marginal makes disproportionality undefined).", 422);
      }
      logEvent("bio.safety_signal.success", { latencyMs: Date.now() - start, mode: "2x2", signal: result.signal });
      return ok(result);
    }

    // Live FAERS path — memoized in Postgres to spare the rate-limited openFDA API.
    const { drug, event } = parsed.data;
    const assessment = await cachedBio(
      optionalPool(),
      "faers",
      `${drug}|${event}`.toLowerCase(),
      () => assessSafetySignal(drug, event)
    );
    if (!assessment) {
      // Honest empty result — never a fabricated signal.
      return ok({ drug, event, found: false });
    }
    logEvent("bio.safety_signal.success", {
      latencyMs: Date.now() - start,
      mode: "faers",
      signal: assessment.signal,
    });
    return ok({ found: true, ...assessment });
  } catch (err) {
    logEvent("bio.safety_signal.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/bio/safety-signal] failed:", err);
    return fail(
      "Something went wrong while assessing the safety signal. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
