import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { verifyBiomedicalClaim } from "@/lib/bio/verifyBiomedicalClaim";
import { BiomedicalClaimRequestSchema } from "@/lib/bio/biomedical.schemas";

// Public POST endpoint for the UNIFIED BIOMEDICAL CLAIM VERIFIER — the capstone that
// composes PaperTrail's deterministic bio engines into ONE verdict. Given { claim }
// (a free-text biomedical sentence, e.g. "PCSK9 loss-of-function protects against
// coronary artery disease"), it extracts the claim's entities with PubTator to ROUTE
// which evidence checks apply, runs only the relevant deterministic engines (genetics,
// variant pathogenicity, target–disease, safety, bioactivity, PGx) in parallel, and
// returns a unified verdict.
//
// The overall verdict is a PURE deterministic function of the component verdicts — NO
// LLM is in the numeric/decision path. On upstream failure each check degrades to an
// honest omission, and a claim with no runnable entity returns insufficient_evidence
// rather than a fabricated confident answer.
//
// The claim text is validated + trimmed at the boundary and NEVER written to a log line.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("bio.verify_claim.rate_limited", { ip });
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
  const parsed = BiomedicalClaimRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid claim-verification request — ${where}${issue?.message ?? "provide a claim to verify."}`,
      400
    );
  }

  try {
    const result = await verifyBiomedicalClaim({ claim: parsed.data.claim });

    // Log only non-sensitive metadata — never the claim text or the resolved entities
    // (which can echo unpublished research content). Counts + verdicts are safe.
    logEvent("bio.verify_claim.success", {
      latencyMs: Date.now() - start,
      overallVerdict: result.overallVerdict,
      checkCount: result.checks.length,
      checkKinds: result.checks.map((c) => c.kind),
    });

    return ok(result);
  } catch (err) {
    logEvent("bio.verify_claim.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/bio/verify-claim] failed:", err);
    return fail(
      "Something went wrong while verifying the biomedical claim. This has been logged — please check your input and try again.",
      500
    );
  }
}
