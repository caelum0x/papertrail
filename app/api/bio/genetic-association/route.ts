import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { verifyGeneticAssociation } from "@/lib/bio/geneticAssociation";
import { GeneticAssociationRequestSchema } from "@/lib/bio/genetics.schemas";

// Public POST endpoint for GENETIC ASSOCIATION VERIFICATION. Given { gene?, variant?,
// disease } it queries the EBI GWAS Catalog + NCBI ClinVar and returns a DETERMINISTIC
// verdict (genome_wide_significant at p<=5e-8, suggestive, reported_not_significant,
// clinvar_pathogenic, conflicting, or no_association_found) with the supporting records.
// The verdict is decided by field-standard significance thresholds over the API records —
// no LLM in the loop, and nothing is fabricated: an empty upstream response yields an
// honest no_association_found rather than a guess.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("bio.genetic_association.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = GeneticAssociationRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid genetic-association request — ${where}${issue?.message ?? "provide a disease plus a gene or variant."}`,
      400
    );
  }

  try {
    const result = await verifyGeneticAssociation(parsed.data);
    logEvent("bio.genetic_association.success", {
      latencyMs: Date.now() - start,
      verdict: result.verdict,
      gwasCount: result.supporting.gwas.length,
      clinvarCount: result.supporting.clinvar.length,
    });
    return ok(result);
  } catch (err) {
    logEvent("bio.genetic_association.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/bio/genetic-association] failed:", err);
    return fail(
      "Something went wrong while verifying the genetic association. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
