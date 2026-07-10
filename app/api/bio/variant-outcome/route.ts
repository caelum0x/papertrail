import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { verifyVariantOutcomeConsistency } from "@/lib/bio/rules/variantOutcomeConsistency";
import { VariantOutcomeRequestSchema } from "@/lib/bio/bioinformatics.schemas";

// Public POST endpoint for VARIANT→OUTCOME CONSISTENCY. Given a variant (rsId / hgvs /
// gene, optionally narrowed by condition) and a claimed direction (protective | risk), it
// reuses the deterministic ClinVar path (verifyPathogenicityClaim) and reports whether the
// claimed direction is consistent with ClinVar's registered clinical significance —
// flagging a claim that contradicts a confident ClinVar record as overstated. NO LLM;
// nothing is fabricated (no record / VUS / conflicting yields an honest empty or negative).
// Never logs the request text.
//
// Data source: NCBI ClinVar (public domain). PUBLIC compute route, mirroring the other
// app/api/bio/* endpoints.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("bio.variant_outcome.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = VariantOutcomeRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid variant-outcome request — ${where}${issue?.message ?? "provide a variant identifier and a claimedDirection."}`,
      400
    );
  }

  // Require at least one variant identifier (the schema allows all three to be optional).
  if (!parsed.data.rsId && !parsed.data.hgvs && !parsed.data.gene) {
    return fail(
      "Invalid variant-outcome request — provide at least one of `rsId`, `hgvs`, or `gene`.",
      400
    );
  }

  try {
    const result = await verifyVariantOutcomeConsistency({
      rsId: parsed.data.rsId,
      hgvs: parsed.data.hgvs,
      gene: parsed.data.gene,
      condition: parsed.data.condition,
      claimedDirection: parsed.data.claimedDirection,
    });

    logEvent("bio.variant_outcome.success", {
      latencyMs: Date.now() - start,
      signal: result.signal,
      verdict: result.pathogenicity.verdict,
      registeredDirection: result.registeredDirection,
    });
    return ok(result);
  } catch (err) {
    logEvent("bio.variant_outcome.error", {
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/bio/variant-outcome] failed:", err);
    return fail(
      "Something went wrong while checking variant→outcome consistency. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
