import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { checkRateLimit } from "@/lib/rateLimit";
import { sanitizeClaimText } from "@/lib/api/claimInput";
import { ok, fail } from "@/lib/api/response";
import { logEvent } from "@/lib/logger";
import { auditGuideline } from "@/lib/guidelineAudit/audit";

export const runtime = "nodejs";

// PUBLIC compute route: paste a clinical guideline / press release IN → a claim-by-claim
// audit OUT (each efficacy claim extracted by Claude and verified against primary
// sources). Mirrors /api/verify's public-route hardening — nodejs runtime, IP rate
// limiting, input sanitisation before anything downstream, NEVER logging the document
// text — and returns the standard { success, data, error } envelope via ok/fail.
//
// Heavy Claude (claim extraction) sits in front of a deterministic verification loop;
// the numeric verdicts never come from an LLM.

// A whole document is longer than a single claim, so the cap is larger here than on
// /api/verify. It still bounds token spend and rejects paste-bombs.
const MAX_DOCUMENT_LENGTH = 24000;
const MIN_DOCUMENT_LENGTH = 40;

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("guideline_audit.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  // Same character-quality hardening as the claim routes (control/invisible chars,
  // degenerate repetition, length cap) applied to the whole document BEFORE it reaches
  // Claude, retrieval, or the DB. The cleaned string is what we audit.
  const sanitized = sanitizeClaimText(body.text, {
    maxLength: MAX_DOCUMENT_LENGTH,
    tooLongError:
      "Document is too long (max 24000 characters). Paste the relevant section (e.g. the efficacy/results portion).",
  });
  if (!sanitized.ok) {
    return fail(sanitized.error, 400);
  }
  const text = sanitized.value;
  if (text.length < MIN_DOCUMENT_LENGTH) {
    return fail(
      "Please paste a longer passage (at least 40 characters) so there is something to audit.",
      400
    );
  }

  try {
    const pool = getPool();
    const result = await auditGuideline(pool, text);

    // Metadata only — never the document text or claim text.
    logEvent("guideline_audit.success", {
      latencyMs: Date.now() - start,
      claims: result.summary.total,
      overstated: result.summary.overstated,
      unsupported: result.summary.unsupported,
      accurate: result.summary.accurate,
    });

    return ok(result);
  } catch (err) {
    logEvent("guideline_audit.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/guideline-audit] failed:", err);
    return fail(
      "Something went wrong while auditing this document. This has been logged — please try again, or paste a shorter passage.",
      500
    );
  }
}
