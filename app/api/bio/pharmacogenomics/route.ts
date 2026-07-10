import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { verifyPgxClaim } from "@/lib/bio/pharmgkb";
import { PgxRequestSchema } from "@/lib/bio/pharmgkb.schemas";

// Public POST endpoint for PHARMACOGENOMIC ANNOTATION VERIFICATION over PharmGKB /
// ClinPGx. Given { gene?, variant?, drug, claimedEffect? } it queries the PharmGKB
// REST API and returns a DETERMINISTIC verdict — high_confidence (evidence level
// 1A/1B), moderate (2A/2B), preliminary (3/4), or not_found — plus the strongest
// matching clinical annotation and the supporting records. The verdict is decided by
// the documented PharmGKB evidence-level ordering over the API records: NO LLM in the
// loop, and nothing is fabricated — an empty upstream response yields an honest
// not_found rather than a guess.
//
// ATTRIBUTION: returned annotation content is PharmGKB / ClinPGx data, CC BY-SA 4.0.
// The result carries an `attribution` field noting the share-alike obligation.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("bio.pharmacogenomics.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  // Validate at the boundary — never trust the raw request. Surface the first
  // validation issue as a user-facing message rather than a raw Zod dump. We never
  // log the claimedEffect / claim text.
  const parsed = PgxRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid pharmacogenomics request — ${where}${issue?.message ?? "provide a drug plus an optional gene or variant."}`,
      400
    );
  }

  try {
    const result = await verifyPgxClaim(parsed.data);
    logEvent("bio.pharmacogenomics.success", {
      latencyMs: Date.now() - start,
      verdict: result.verdict,
      strongestEvidenceLevel: result.strongestEvidenceLevel,
      annotationCount: result.annotations.length,
    });
    return ok(result);
  } catch (err) {
    logEvent("bio.pharmacogenomics.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/bio/pharmacogenomics] failed:", err);
    return fail(
      "Something went wrong while verifying the pharmacogenomic annotation. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
