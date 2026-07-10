import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import {
  assembleRepurposingEvidence,
  summarizeRepurposing,
} from "@/lib/bio/repurposing";
import { RepurposingRequestSchema } from "@/lib/bio/repurposing.schemas";

// Public POST endpoint for DRUG-REPURPOSING EVIDENCE BUNDLES. Given
// { drug, indication } (e.g. { "metformin", "colorectal cancer" }) it deterministically
// assembles the evidence for the proposed link from four engines PaperTrail already
// built — Open Targets (genetic target<->indication association), ChEMBL (max clinical
// phase + target bioactivity, CC BY-SA 3.0), ClinicalTrials.gov (existing trials incl.
// failures), and FDA FAERS (pharmacovigilance) — and returns a DETERMINISTIC composite
// score in [0,1] plus a verdict (strong_rationale | plausible | weak | discouraged).
//
// NO LLM is in the numeric path: the score/verdict are a pure function of the assembled
// signals. An optional `?summarize=true` adds a Claude-written plain-language summary
// that references only the assembled evidence (Zod-validated) — it never changes a
// number, and if it fails the bundle is still returned.
//
// On upstream failure each component degrades to an honest empty signal (never a
// fabricated value); the bundle is scored on what could be assembled.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("bio.repurposing.rate_limited", { ip });
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
  const parsed = RepurposingRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid repurposing request — ${where}${issue?.message ?? "provide { drug, indication }."}`,
      400
    );
  }

  // Opt-in Claude summary. Off by default so the endpoint costs zero tokens and
  // stays fully deterministic unless the caller explicitly asks for prose.
  const wantSummary = new URL(req.url).searchParams.get("summarize") === "true";

  try {
    const { drug, indication } = parsed.data;

    // Deterministic bundle — the source of truth, assembled from real bio-data.
    const evidence = await assembleRepurposingEvidence({ drug, indication });

    // Optional, strictly-additive prose layer. Isolated: a summary failure must
    // never discard the deterministic bundle the caller came for.
    let summary = null;
    if (wantSummary) {
      try {
        summary = await summarizeRepurposing(evidence);
      } catch (summaryErr) {
        logEvent("bio.repurposing.summary_error", { error: String(summaryErr) });
        summary = null;
      }
    }

    // Never log claim/drug/indication text — only non-identifying signal metadata.
    logEvent("bio.repurposing.success", {
      latencyMs: Date.now() - start,
      verdict: evidence.verdict,
      score: evidence.score,
      associationFound: evidence.sharedTargets.associationFound,
      trialCount: evidence.existingTrials.count,
      hasFailedTrial: evidence.existingTrials.hasFailedTrial,
      safetySignal: evidence.safety.signal,
      summarized: summary !== null,
    });

    return ok({
      ...evidence,
      // Present only when requested AND produced; omitted otherwise so the shape
      // stays honest (no null-summary noise on the common deterministic path).
      ...(summary ? { summary } : {}),
    });
  } catch (err) {
    logEvent("bio.repurposing.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/bio/repurposing] failed:", err);
    return fail(
      "Something went wrong while assembling the repurposing evidence bundle. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
