import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { getPool } from "@/lib/db";
import { ingestClaimGraph, queryPath } from "@/lib/kg/graph";
import { KgRequestSchema } from "@/lib/kg/schemas";
import type { KgPool } from "@/lib/kg/repository";

// Public POST endpoint for the BIOMEDICAL EVIDENCE KNOWLEDGE GRAPH.
//
// Two modes, exactly one per request (validated by KgRequestSchema):
//   { ingest: { text } } — ground the text to normalized entities (PubTator) and
//     derive typed, provenance-bearing edges from the DETERMINISTIC bio-relation
//     engines (genetic association, Open Targets), persisting nodes + edges. Returns
//     an honest summary of what was written.
//   { path: { from, to, maxHops? } } — return a provenance-annotated evidence path
//     between two normalized entity ids, or null when none exists.
//
// NO LLM sits in any load-bearing number: entity linking is PubTator's, edge
// confidence is the bio engines' deterministic output. On upstream/DB failure the
// pipeline degrades to an honest empty result rather than a fabricated fact.
//
// The caller's ingest text is NEVER logged (only entity/edge counts and latency),
// mirroring app/api/bio/target-disease/route.ts.
export const runtime = "nodejs";

// The KG persistence layer requires a real pool. If the DB is unconfigured we fail
// explicitly (unlike the bio cache, the graph is the product here — there is no
// meaningful degraded mode without persistence).
function requirePool(): KgPool | null {
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
    logEvent("kg.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  // Validate at the boundary — never trust the raw request body.
  const parsed = KgRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid knowledge-graph request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  const pool = requirePool();
  if (!pool) {
    logEvent("kg.db_unconfigured", {});
    return fail("The knowledge graph is temporarily unavailable.", 503);
  }

  try {
    if (parsed.data.ingest) {
      const result = await ingestClaimGraph({ text: parsed.data.ingest.text }, pool);
      logEvent("kg.ingest.success", {
        latencyMs: Date.now() - start,
        nodesUpserted: result.nodesUpserted,
        edgesUpserted: result.edgesUpserted,
      });
      // Never echo the ingest text back; return only the auditable graph summary.
      return ok(result);
    }

    // path mode
    const { from, to, maxHops } = parsed.data.path!;
    const path = await queryPath(from, to, pool, { maxHops });
    logEvent("kg.path.success", {
      latencyMs: Date.now() - start,
      found: path !== null,
      hops: path?.hops ?? null,
    });
    return ok({ found: path !== null, path });
  } catch (err) {
    logEvent("kg.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/kg] failed:", err);
    return fail(
      "Something went wrong while working with the knowledge graph. This has been logged — please try again.",
      500
    );
  }
}
