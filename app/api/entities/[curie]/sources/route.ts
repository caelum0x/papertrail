import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { getPool } from "@/lib/db";
import { getSourcesForEntity } from "@/lib/ingest/entitySourceQueries";
import { CurieParamSchema, PaginationQuerySchema } from "@/lib/ingest/sourcesByEntity.schemas";

// Public GET endpoint (path-param variant of /api/sources/by-entity):
// GET /api/entities/HGNC:6024/sources?limit=&offset= returns the cached sources tagged, at
// ingest time, with that canonical ontology CURIE — joining the INGEST-TIME entity index
// (document_entities) to `sources`. Serves ENTIRELY from the shared cache — no NER, no
// network, no LLM (CLAUDE.md cache-everything rule). Public + IP rate-limited; never logs
// source text — only ids/counts.
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ curie: string }> }
) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("ingest.entity_sources.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  // The CURIE arrives URL-encoded in the path (the ':' is percent-encoded by clients);
  // Next decodes route params, but decode defensively in case a raw %3A slips through.
  const rawParam = (await params).curie ?? "";
  let decodedCurie = rawParam;
  try {
    decodedCurie = decodeURIComponent(rawParam);
  } catch {
    // A malformed percent-encoding — fall through to schema validation on the raw value.
  }

  const curieParsed = CurieParamSchema.safeParse(decodedCurie);
  if (!curieParsed.success) {
    const issue = curieParsed.error.issues[0];
    return fail(
      `Invalid entity curie — ${issue?.message ?? "provide a CURIE of the form PREFIX:LOCAL_ID."}`,
      400
    );
  }

  const { searchParams } = new URL(req.url);
  const pageParsed = PaginationQuerySchema.safeParse({
    limit: searchParams.get("limit") ?? undefined,
    offset: searchParams.get("offset") ?? undefined,
  });
  if (!pageParsed.success) {
    const issue = pageParsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(`Invalid pagination — ${where}${issue?.message ?? "check limit/offset."}`, 400);
  }

  const curie = curieParsed.data;
  const effectiveLimit = pageParsed.data.limit ?? 20;
  const effectiveOffset = pageParsed.data.offset ?? 0;

  try {
    const page = await getSourcesForEntity(getPool(), curie, effectiveLimit, effectiveOffset);
    logEvent("ingest.entity_sources.success", {
      latencyMs: Date.now() - start,
      returned: page.sources.length,
      total: page.total,
    });
    return ok(page, { total: page.total, limit: effectiveLimit });
  } catch (err) {
    logEvent("ingest.entity_sources.error", {
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/entities/[curie]/sources] failed:", err);
    return fail(
      "Something went wrong while loading sources for this entity. This has been logged — please try again shortly.",
      500
    );
  }
}
