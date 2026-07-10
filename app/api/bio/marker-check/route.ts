import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { getPool } from "@/lib/db";
import {
  verifyMarkerCanonicalization,
  defaultMarkerDeps,
} from "@/lib/bio/rules/markerCanonicalization";
import { MarkerCheckRequestSchema } from "@/lib/bio/bioinformatics.schemas";

// Public POST endpoint for CELL-TYPE MARKER CHECK. Given { markerGenes[], cellType } it
// resolves each gene to a canonical ontology term (DETERMINISTIC ontology match, NO LLM),
// loads the curated cell_marker_panels for the cell type, and reports per-gene whether the
// gene is a registered marker of that cell type and in a consistent direction — flagging
// genes that are not markers or are registered in the opposite direction as overstated.
// Nothing is fabricated: an unresolved gene, or a cell type with no curated panel, yields
// an honest miss rather than a guess. Never logs the request text.
//
// PUBLIC compute route (the ontology tables are public reference data, no org scoping),
// mirroring the other app/api/bio/* endpoints.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("bio.marker_check.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = MarkerCheckRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid marker-check request — ${where}${issue?.message ?? "provide markerGenes and a cellType."}`,
      400
    );
  }

  try {
    const result = await verifyMarkerCanonicalization(
      { markerGenes: parsed.data.markerGenes, cellType: parsed.data.cellType },
      defaultMarkerDeps(getPool())
    );

    logEvent("bio.marker_check.success", {
      latencyMs: Date.now() - start,
      signal: result.signal,
      cellTypeMatched: result.cellTypeMatched,
      geneCount: result.genes.length,
    });
    return ok(result);
  } catch (err) {
    logEvent("bio.marker_check.error", {
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/bio/marker-check] failed:", err);
    return fail(
      "Something went wrong while checking cell-type markers. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
