import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { verifyPathogenicityClaim } from "@/lib/bio/variantPathogenicity";
import { VariantPathogenicityRequestSchema } from "@/lib/bio/variant.schemas";

// Public POST endpoint for VARIANT PATHOGENICITY VERIFICATION. Given
// { rsId?, hgvs?, gene?, condition?, claimedSignificance? } it queries NCBI ClinVar
// and returns a DETERMINISTIC verdict — confirmed, overstated_certainty (claim says
// pathogenic but ClinVar is VUS/benign or low-star), conflicting, or not_found — with
// the highest-star supporting record. The verdict is decided by ClinVar's documented
// field-standard review-status → star scale over the API records; no LLM in the loop,
// and nothing is fabricated: an empty upstream response yields an honest not_found.
//
// Data source: NCBI ClinVar (public domain).
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("bio.variant_pathogenicity.rate_limited", { ip });
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
  const parsed = VariantPathogenicityRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid variant-pathogenicity request — ${where}${issue?.message ?? "provide an rsId, hgvs, or gene."}`,
      400
    );
  }

  try {
    const result = await verifyPathogenicityClaim(parsed.data);
    logEvent("bio.variant_pathogenicity.success", {
      latencyMs: Date.now() - start,
      verdict: result.verdict,
      recordCount: result.records.length,
      bestStar: result.bestRecord?.starRating ?? null,
    });
    return ok(result);
  } catch (err) {
    logEvent("bio.variant_pathogenicity.error", {
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/bio/variant-pathogenicity] failed:", err);
    return fail(
      "Something went wrong while verifying variant pathogenicity. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
