import { NextRequest } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { runMultiSourceIngest } from "@/lib/ingest/multiSourcePipeline";

// Public MULTI-SOURCE INGEST endpoint (Phase 2 — evidence integration). Given a free-text
// query and/or a canonical entity, it drives the shared ingest pipeline to pull from the
// enabled biomedical databases (PubMed, ClinicalTrials.gov, OpenFDA/FAERS, ClinVar,
// ChEMBL, Open Targets, PubTator) into the shared `sources` cache — reusing already-cached
// rows and only fetching NEW ones (CLAUDE.md caching rule: never live-fetch on a path a
// cached row can serve, and never let the demo depend on live API latency). Ingested
// documents are canonicalized at ingest time (deterministic ontology linking, Claude only
// for NER) and their linked entities persisted per document.
//
// Sources are a PUBLIC, unscoped resource in this codebase (see /api/sources and
// /api/ingest), so this mirrors the public compute routes: nodejs runtime, IP rate limit,
// Zod safeParse, ok/fail envelope, try/catch. NEVER logs query/claim/source text — only
// ids and counts (logger.ts policy).
export const runtime = "nodejs";
export const maxDuration = 60;

// A single ingest can fan out across several upstream APIs; keep the request lean and let
// the pipeline enforce its own per-source caps. `entity` lets the console re-run the exact
// canonical identity resolved on a prior pass (e.g. a resolved CURIE) rather than a surface.
const EntitySchema = z
  .object({
    surface: z.string().trim().min(1).max(200).optional(),
    curie: z.string().trim().min(1).max(200).optional(),
    type: z.string().trim().min(1).max(60).optional(),
  })
  .refine((e) => Boolean(e.surface || e.curie), {
    message: "provide an entity surface or curie.",
  });

const BodySchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(3, "Query must be at least 3 characters.")
      .max(500, "Query is too long (max 500 characters).")
      .optional(),
    entity: EntitySchema.optional(),
    sources: z.array(z.string().trim().min(1).max(60)).max(16).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .refine((b) => Boolean(b.query || b.entity), {
    message: "provide a query or an entity to ingest.",
  });

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("ingest.multi_source.rate_limited", { ip });
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
    return fail(
      `Invalid multi-source ingest request — ${where}${issue?.message ?? "provide a query or an entity."}`,
      400
    );
  }

  const input = {
    query: parsed.data.query,
    entity: parsed.data.entity,
    sources: parsed.data.sources,
    limit: parsed.data.limit,
  };

  try {
    const result = await runMultiSourceIngest(getPool(), input);

    // Metadata only — never the query/entity/source text. Coverage is per-source_type
    // counts, so it is safe to log (ids/counts, not content).
    logEvent("ingest.multi_source.success", {
      latencyMs: Date.now() - start,
      ingested: result.ingested.length,
      droppedUngrounded: result.droppedUngrounded,
      coverage: result.coverage,
    });

    return ok({
      ingested: result.ingested,
      coverage: result.coverage,
      droppedUngrounded: result.droppedUngrounded,
    });
  } catch (err) {
    logEvent("ingest.multi_source.error", {
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/ingest/multi-source] failed:", err);
    return fail(
      "Something went wrong while running the multi-source ingest. This has been logged — please try again.",
      500
    );
  }
}
