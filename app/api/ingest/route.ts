import { NextRequest } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { searchAndCache } from "@/lib/ingest/searchAndCache";

// Public LIVE SOURCE INGESTION endpoint. Given a free-text query, it searches PubMed +
// ClinicalTrials.gov and caches the results into the `sources` table, reusing rows that
// are already cached and fetching/embedding only NEW ones (CLAUDE.md caching rule: never
// re-fetch what is already cached — the demo must not depend on live API latency). The
// returned cachedSourceIds feed straight into /api/auto-synthesis. Never logs query text.
//
// Sources are a PUBLIC, unscoped resource in this codebase (see lib/queries/sources.ts
// and /api/sources), so this mirrors the public compute routes (nodejs runtime, IP
// rate-limited, Zod-validated, ok/fail envelope) rather than the org-scoped withOrg path.
export const runtime = "nodejs";

const BodySchema = z.object({
  query: z.string().min(3, "Query must be at least 3 characters.").max(500, "Query is too long (max 500 characters)."),
  limit: z.number().int().min(1).max(20).optional(),
});

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("ingest.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(`Invalid ingest request — ${where}${issue?.message ?? "check your inputs."}`, 400);
  }

  const query = parsed.data.query.trim();

  try {
    const result = await searchAndCache(getPool(), { query, limit: parsed.data.limit });

    // Metadata only — the query text itself is never logged (it may reference
    // unpublished research), matching the /api/verify + /api/auto-synthesis policy.
    logEvent("ingest.success", {
      latencyMs: Date.now() - start,
      cached: result.cachedSourceIds.length,
      fetched: result.fetchedCount,
      reused: result.reusedCount,
    });

    return ok({
      source_ids: result.cachedSourceIds,
      fetched_count: result.fetchedCount,
      reused_count: result.reusedCount,
    });
  } catch (err) {
    logEvent("ingest.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/ingest] failed:", err);
    return fail(
      "Something went wrong while ingesting sources for this query. This has been logged — please try again.",
      500
    );
  }
}
