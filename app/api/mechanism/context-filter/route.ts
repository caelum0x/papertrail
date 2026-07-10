import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { getPool } from "@/lib/db";
import { tagMechanismContext } from "@/lib/mechanism/context";
import { MechanismContextRequestSchema } from "@/lib/mechanism/schemas";
import type { KgPool } from "@/lib/kg/repository";

// Public POST endpoint for CONTEXT-AWARE MECHANISM EXTRACTION (native INDRA RefContext port).
//
// { text, tier?, require_human_in_vivo? } -> reuse the mechanism assembler (Claude
//   extracts causal statements; code grounds + scores a deterministic belief), then TAG
//   each statement with biological context — tissue (UBERON-ish), species (NCBI-taxon:
//   human/mouse/rat/in-vitro), assay/system (OBI-ish: in-vivo/in-vitro/cell-line).
//
// Context tags are PROPOSED by Claude as candidates then GROUNDED verbatim to the source
// (ungroundable tags dropped + counted). The normalized species/assay bucket and the
// translation-confidence score (human in-vivo > animal in-vivo > in-vitro) are decided by
// DETERMINISTIC code — no LLM number is load-bearing. With require_human_in_vivo, only
// human in-vivo mechanisms are kept (deterministic filter), de-risking preclinical→human
// translation.
//
// On DB-unavailable the analysis still runs (edgesUpserted = 0); on LLM/upstream failure
// it degrades to an honest empty/partial result rather than fabricating context. The
// caller's source text is NEVER logged (only counts + latency).
export const runtime = "nodejs";

// The KG persistence layer (inherited from the reused assembler) needs a real pool, but
// the context result is meaningful WITHOUT persistence, so a missing pool degrades to
// "analyzed but not persisted" rather than a hard failure.
function optionalPool(): KgPool | null {
  try {
    return getPool() as unknown as KgPool;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("mechanism.context_filter.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  // Validate at the boundary — never trust the raw request body.
  const parsed = MechanismContextRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid mechanism-context request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  const pool = optionalPool();

  try {
    const result = await tagMechanismContext(
      {
        text: parsed.data.text,
        tier: parsed.data.tier,
        requireHumanInVivo: parsed.data.require_human_in_vivo,
      },
      pool
    );
    logEvent("mechanism.context_filter.success", {
      latencyMs: Date.now() - start,
      statements: result.statements.length,
      groundingDroppedCount: result.groundingDroppedCount,
      contextTagsDroppedCount: result.contextTagsDroppedCount,
      edgesUpserted: result.edgesUpserted,
      filteredHumanInVivo: result.filteredHumanInVivo,
      filteredOutCount: result.filteredOutCount,
      persisted: pool !== null,
    });
    // Never echo the source text back; return only the auditable, context-tagged result.
    return ok(result);
  } catch (err) {
    logEvent("mechanism.context_filter.error", {
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/mechanism/context-filter] failed:", err);
    return fail(
      "Something went wrong while extracting mechanism context. This has been logged — please try again.",
      500
    );
  }
}
