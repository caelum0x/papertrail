import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { getPool } from "@/lib/db";
import { verifyBioinformaticsFinding } from "@/lib/bio/verifyBioinformaticsFinding";
import { defaultMarkerDeps } from "@/lib/bio/rules/markerCanonicalization";
import { BioinformaticsFindingRequestSchema } from "@/lib/bio/bioinformatics.schemas";

// Public POST endpoint for BIOINFORMATICS FINDING VERIFICATION. Given an assertion, its
// claimed marker genes + cell type, an effect size, the study population, and the verbatim
// source text, it grounds every quoted number verbatim in the source (dropping + counting
// any it cannot locate), runs the deterministic rule engines (marker canonicalization,
// effect-size sanity, and — when present — variant→outcome consistency / dose-response /
// biomarker validation), and returns a DETERMINISTIC verdict (supported, overstated,
// partially_supported, unsupported, insufficient_evidence). NO LLM is in the numeric/
// decision path; nothing is fabricated. Never logs the source or assertion text.
//
// PUBLIC compute route (no org scoping), mirroring the other app/api/bio/* endpoints.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("bio.verify_finding.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = BioinformaticsFindingRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid verify-finding request — ${where}${issue?.message ?? "provide an assertion and sourceText."}`,
      400
    );
  }

  try {
    // Wire the DB-backed marker engine deps only when a cell type + marker genes are
    // present (the only check that needs a database handle). Everything else is pure.
    const needsMarker =
      parsed.data.markerGenes.length > 0 && Boolean(parsed.data.cellType);
    const markerDeps = needsMarker ? defaultMarkerDeps(getPool()) : undefined;

    const result = await verifyBioinformaticsFinding(parsed.data, { markerDeps });

    logEvent("bio.verify_finding.success", {
      latencyMs: Date.now() - start,
      verdict: result.verdict,
      checkCount: result.signals.length,
      flaggedSpanCount: result.flagged_spans.length,
      droppedUngrounded: result.droppedUngrounded,
    });
    return ok(result);
  } catch (err) {
    logEvent("bio.verify_finding.error", {
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/bio/verify-finding] failed:", err);
    return fail(
      "Something went wrong while verifying the finding. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
