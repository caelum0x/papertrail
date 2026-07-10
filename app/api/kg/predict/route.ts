import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { getPool } from "@/lib/db";
import { getNodeByNormalizedId, type KgPool } from "@/lib/kg/repository";
import { predictLinks, type ScorerName } from "@/lib/kg/linkPredict";
import { KG_PREDICATES, type KgPredicate } from "@/lib/kg/schemas";
import { toBiolinkCategory, toBiolinkPredicate, isWellTypedTriple } from "@/lib/kg/biolink";

// Public POST endpoint for TOPOLOGY-BASED LINK PREDICTION over the evidence graph.
//
// Given a `from` normalized entity id (and optionally a target `predicate` and scorer),
// rank candidate object nodes that are NOT already directly linked from `from` by their
// structural proximity in the graph — a NOVEL repurposing / association hypothesis list.
// The scorers (common-neighbors, Adamic-Adar, resource-allocation, preferential-
// attachment) are pure topology math ported from PyKEEN's non-parametric baselines
// (lib/kg/linkPredict.ts). NO LLM sits in any score.
//
// When a target predicate is supplied, we additionally enforce Biolink well-typing
// (lib/kg/biolink.ts): a candidate is only returned if the (from, predicate, candidate)
// triple respects the predicate's Biolink domain/range — an ill-typed guess is dropped
// rather than surfaced as a hypothesis.
//
// The response carries Biolink CURIEs alongside our native types so consumers get an
// ontology-grounded, auditable prediction. No caller identifier or entity text is
// logged (only the id, counts, latency).
export const runtime = "nodejs";

const ScorerSchema = z.enum([
  "common_neighbors",
  "adamic_adar",
  "resource_allocation",
  "preferential_attachment",
]);

const PredictRequestSchema = z.object({
  from: z.string().trim().min(1).max(128),
  predicate: z.enum(KG_PREDICATES).optional(),
  scorer: ScorerSchema.optional(),
  radius: z.number().int().min(1).max(4).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

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
    logEvent("kg.predict.rate_limited", {});
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = PredictRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid prediction request — ${where}${issue?.message ?? "check your inputs."}`,
      400
    );
  }

  const pool = requirePool();
  if (!pool) {
    logEvent("kg.predict.db_unconfigured", {});
    return fail("The knowledge graph is temporarily unavailable.", 503);
  }

  const { from, predicate, scorer, radius, limit } = parsed.data;

  try {
    const fromNode = await getNodeByNormalizedId(pool, from);
    if (!fromNode) {
      logEvent("kg.predict.unknown_source", { latencyMs: Date.now() - start });
      // Honest "no support" rather than a fabricated result for an unknown node.
      return ok({
        from: null,
        predicate: predicate ?? "associates_with",
        scorer: (scorer ?? "adamic_adar") as ScorerName,
        predictions: [],
      });
    }

    // Only enforce Biolink well-typing when the caller pinned a predicate — otherwise we
    // rank purely on topology and let every candidate through.
    const targetPredicate: KgPredicate = predicate ?? "associates_with";
    const accept = predicate
      ? (subjectType: string, objectType: string) =>
          isWellTypedTriple(subjectType, targetPredicate, objectType)
      : undefined;

    const predictions = await predictLinks(pool, fromNode, {
      scorer,
      predicate: targetPredicate,
      radius,
      limit,
      accept,
    });

    logEvent("kg.predict.success", {
      latencyMs: Date.now() - start,
      count: predictions.length,
      scorer: scorer ?? "adamic_adar",
    });

    return ok({
      from: {
        id: fromNode.id,
        entityType: fromNode.entityType,
        name: fromNode.name,
        normalizedId: fromNode.normalizedId,
        biolinkCategory: toBiolinkCategory(fromNode.entityType),
      },
      predicate: targetPredicate,
      biolinkPredicate: toBiolinkPredicate(targetPredicate),
      scorer: (scorer ?? "adamic_adar") as ScorerName,
      predictions: predictions.map((p) => ({
        object: {
          id: p.object.id,
          entityType: p.object.entityType,
          name: p.object.name,
          normalizedId: p.object.normalizedId,
          biolinkCategory: toBiolinkCategory(p.object.entityType),
        },
        predicate: p.predicate,
        biolinkPredicate: toBiolinkPredicate(p.predicate),
        score: p.score,
      })),
    });
  } catch (err) {
    logEvent("kg.predict.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/kg/predict] failed:", err);
    return fail(
      "Something went wrong while predicting links. This has been logged — please try again.",
      500
    );
  }
}
