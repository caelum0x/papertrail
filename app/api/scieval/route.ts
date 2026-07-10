import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { ScievalRequestSchema } from "@/lib/scieval/schemas";
import { verifyClaim } from "@/lib/scieval/verify";

// Public POST endpoint for SciEval — the native MultiVerS + SciFact port. Given a
// { claim, abstract? }, it assigns a SUPPORTS / REFUTES / NEI label and selects the
// rationale sentences from the abstract (Claude), then GROUNDS each rationale to the
// abstract; ungroundable rationales are dropped and a non-NEI label with no surviving
// rationale is downgraded to NEI. When no abstract is supplied, a matching cached source
// abstract is retrieved; if none is confident, we return an honest "no source found".
// Never logs claim or abstract text — only metadata.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("scieval.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = ScievalRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid verification request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  try {
    const outcome = await verifyClaim(parsed.data);

    if (outcome.status === "no_source_found") {
      logEvent("scieval.no_source_found", { latencyMs: Date.now() - start });
      return ok(outcome);
    }

    logEvent("scieval.success", {
      latencyMs: Date.now() - start,
      label: outcome.verification.label,
      rationaleCount: outcome.verification.rationales.length,
      droppedRationaleCount: outcome.verification.dropped_rationale_count,
      downgradedToNei: outcome.verification.downgraded_to_nei,
      fromRetrieval: outcome.source !== undefined,
    });

    return ok(outcome);
  } catch (err) {
    logEvent("scieval.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/scieval] failed:", err);
    return fail(
      "Something went wrong while verifying this claim. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
