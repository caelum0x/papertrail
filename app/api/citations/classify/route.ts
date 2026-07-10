import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { sanitizeClaimText } from "@/lib/api/claimInput";
import { classifyCitation } from "@/lib/citations/classify";

// Public smart-citation classifier (Scite-style). Given a CITING passage and the
// CITED work's claim, Claude classifies the citation STANCE (supporting /
// contrasting / mentioning) and extracts the exact citation-context sentence; the
// trust layer grounds that sentence to the citing text before we return it.
//
// Mirrors app/api/verify/route.ts: nodejs runtime, rate-limited, envelope
// responses, input hardened before any LLM sees it, and NEVER logs the passage or
// claim text.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("citations.classify.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let body: { citing_text?: string; cited_claim?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  // Reuse the shared free-text hardening (control chars, invisible/bidi smuggling,
  // degenerate repetition, max length) for BOTH inputs before any LLM sees them.
  const citing = sanitizeClaimText(body.citing_text, {
    maxLength: 6000,
    tooLongError:
      "Citing passage is too long (max 6000 characters). Paste the paragraph that contains the citation.",
  });
  if (!citing.ok) {
    return fail(`Citing passage: ${citing.error}`, 400);
  }
  if (citing.value.length < 20) {
    return fail("Please paste a citing passage of at least 20 characters.", 400);
  }

  const cited = sanitizeClaimText(body.cited_claim, {
    maxLength: 2000,
    tooLongError:
      "Cited claim is too long (max 2000 characters). Summarize the cited work's finding in a sentence.",
  });
  if (!cited.ok) {
    return fail(`Cited claim: ${cited.error}`, 400);
  }
  if (cited.value.length < 10) {
    return fail("Please provide a cited claim of at least 10 characters.", 400);
  }

  try {
    const outcome = await classifyCitation({
      citing_text: citing.value,
      cited_claim: cited.value,
    });

    if (outcome.status === "ungroundable") {
      logEvent("citations.classify.ungroundable", { latencyMs: Date.now() - start });
      return ok(outcome);
    }

    logEvent("citations.classify.success", {
      latencyMs: Date.now() - start,
      stance: outcome.classification.stance,
      groundingStatus: outcome.classification.grounding.status,
      confidence: outcome.classification.confidence,
    });
    return ok(outcome);
  } catch (err) {
    logEvent("citations.classify.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/citations/classify] failed:", err);
    return fail(
      "Something went wrong while classifying this citation. This has been logged — please try again, or rephrase.",
      500
    );
  }
}
