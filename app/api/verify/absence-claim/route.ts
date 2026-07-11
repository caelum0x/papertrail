import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { verifyAbsenceClaim } from "@/lib/grounding/negationEntailment";

// Public POST endpoint for NEGATION-AWARE (ABSENCE) claim verification. Given
// { claim, source_text } it decides the claim's polarity DETERMINISTICALLY from a
// negation-cue lexicon, then asks Claude the polarity-NEUTRAL question "does the source
// assert PRESENCE / ABSENCE / NEITHER of the effect?" (returning a verbatim supporting
// sentence), grounds that sentence in the source, and maps (polarity x assertion) to a final
// label by a FIXED table: supported | negative_supported | refuted | nei.
//
// MOAT: no LLM decides the polarity, the score, or the final label — those are deterministic
// rules and a fixed table. The only model step is the neutral presence/absence judgement, and
// it counts only once its supporting sentence is grounded verbatim in the source; an
// ungroundable support is dropped and the verdict falls back honestly to `nei`. Native TS port
// of backend/engines/MiniCheck/papertrail_negation.py. Claim and source text are NEVER logged
// — only ids/counts/verdicts.
export const runtime = "nodejs";

const AbsenceClaimRequestSchema = z.object({
  claim: z.string().trim().min(1, "claim must be a non-empty string").max(2000),
  source_text: z
    .string()
    .trim()
    .min(1, "source_text must be a non-empty string")
    .max(100000),
  effect: z.string().trim().min(1).max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("verify.absence_claim.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = AbsenceClaimRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid absence-claim request — ${where}${
        issue?.message ?? "provide a claim and source_text."
      }`,
      400
    );
  }

  try {
    const result = await verifyAbsenceClaim({
      claim: parsed.data.claim,
      sourceText: parsed.data.source_text,
      effect: parsed.data.effect,
    });

    logEvent("verify.absence_claim.success", {
      latencyMs: Date.now() - start,
      polarity: result.polarity,
      negationCueCount: result.negation_cues.length,
      sourceAssertion: result.source_assertion,
      label: result.label,
      grounded: result.supporting_span !== null,
      groundingDropped: result.grounding_dropped,
    });
    return ok(result);
  } catch (err) {
    logEvent("verify.absence_claim.error", {
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/verify/absence-claim] failed:", err);
    return fail(
      "Something went wrong while verifying the absence claim. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
