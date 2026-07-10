import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { getPool } from "@/lib/db";
import { assembleMechanisms } from "@/lib/mechanism/assemble";
import { MechanismRequestSchema } from "@/lib/mechanism/schemas";
import type { KgPool } from "@/lib/kg/repository";

// Public POST endpoint for MECHANISM-STATEMENT ASSEMBLY (native INDRA port).
//
// { text, tier? } -> Claude extracts causal mechanistic statements
//   { subj, relation, obj, evidenceQuote }; each evidence quote is GROUNDED verbatim to
//   the source text (ungroundable quotes dropped); statements are de-duplicated and
//   scored with a DETERMINISTIC belief = 1 - prod(1 - reliability_i); each statement is
//   persisted as a provenance-bearing edge in the knowledge graph.
//
// The belief number is NOT an LLM number — Claude only proposes candidate tuples; the
// grounding and belief math are deterministic code. On DB-unavailable the assembly
// still runs and returns statements (edgesUpserted = 0); on LLM/upstream failure it
// degrades to an honest empty result rather than fabricating mechanisms.
//
// The caller's source text is NEVER logged (only statement/edge counts and latency).
export const runtime = "nodejs";

// The KG persistence layer needs a real pool, but unlike /api/kg the mechanism result
// is meaningful WITHOUT persistence (the grounded, scored statements stand alone), so a
// missing pool degrades to "assembled but not persisted" rather than a hard failure.
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
    logEvent("mechanism.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  // Validate at the boundary — never trust the raw request body.
  const parsed = MechanismRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid mechanism request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  const pool = optionalPool();

  try {
    const result = await assembleMechanisms(
      { text: parsed.data.text, tier: parsed.data.tier },
      pool
    );
    logEvent("mechanism.assemble.success", {
      latencyMs: Date.now() - start,
      statements: result.statements.length,
      groundingDroppedCount: result.groundingDroppedCount,
      edgesUpserted: result.edgesUpserted,
      persisted: pool !== null,
    });
    // Never echo the source text back; return only the auditable assembly result.
    return ok(result);
  } catch (err) {
    logEvent("mechanism.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/mechanism] failed:", err);
    return fail(
      "Something went wrong while assembling mechanistic statements. This has been logged — please try again.",
      500
    );
  }
}
