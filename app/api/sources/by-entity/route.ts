import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { getPool } from "@/lib/db";
import { getSourcesForEntity } from "@/lib/ingest/entitySourceQueries";
import { SourcesByEntityQuerySchema } from "@/lib/ingest/sourcesByEntity.schemas";

// Public GET endpoint: the cached sources tagged (at ingest time) with a canonical
// ontology entity. GET /api/sources/by-entity?curie=HGNC:6024&limit=&offset= joins the
// INGEST-TIME entity index (document_entities) to `sources` and returns the documents that
// mention that CURIE, ordered by mention salience. Serves ENTIRELY from the shared cache —
// no NER, no network, no LLM (CLAUDE.md cache-everything rule; the demo never depends on
// live latency). Public + IP rate-limited; never logs the source text — only ids/counts.
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("ingest.sources_by_entity.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  const { searchParams } = new URL(req.url);
  const parsed = SourcesByEntityQuerySchema.safeParse({
    curie: searchParams.get("curie") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
    offset: searchParams.get("offset") ?? undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid request — ${where}${issue?.message ?? "provide a curie query param."}`,
      400
    );
  }

  const { curie, limit, offset } = parsed.data;
  const effectiveLimit = limit ?? 20;
  const effectiveOffset = offset ?? 0;

  try {
    const page = await getSourcesForEntity(getPool(), curie, effectiveLimit, effectiveOffset);
    logEvent("ingest.sources_by_entity.success", {
      latencyMs: Date.now() - start,
      returned: page.sources.length,
      total: page.total,
    });
    return ok(page, { total: page.total, limit: effectiveLimit });
  } catch (err) {
    logEvent("ingest.sources_by_entity.error", {
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/sources/by-entity] failed:", err);
    return fail(
      "Something went wrong while loading sources for this entity. This has been logged — please try again shortly.",
      500
    );
  }
}
