import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { getPool } from "@/lib/db";
import { getNodeByNormalizedId, type KgPool } from "@/lib/kg/repository";
import { KG_PREDICATES, type KgPredicate } from "@/lib/kg/schemas";
import {
  loadEmbeddings,
  predictLearnedLinks,
  trainAndPersist,
} from "@/lib/kg/learnedLinkPredict";

// Public POST endpoint for LEARNED knowledge-graph LINK PREDICTION.
//
// Given { from, predicate?, limit? } — where `from` is a normalized entity id already
// in the KG (e.g. "NCBI Gene:673", "MESH:D009369") — it ranks candidate NOVEL links
// out of that entity by the deterministic TransE distance ||from + rel - to|| over the
// learned kg_embeddings (migration 0068). Smaller distance = stronger predicted link.
//
// If no embeddings exist yet, the route TRAINS them on demand from kg_edges (a fixed-
// seed, hash-initialized, margin-ranking TransE mirror of backend/engines/pykeen/
// papertrail_train.py) and persists them, then scores. There is NO LLM anywhere in a
// score or in training — the ranking is pure deterministic math. When learned scoring
// is genuinely unavailable (no edges to train on, or the source has no vector), the
// response carries an honest `note` and an empty list rather than a fabricated link.
export const runtime = "nodejs";

const LearnedPredictRequestSchema = z.object({
  from: z.string().trim().min(1).max(128),
  predicate: z.enum(KG_PREDICATES).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("kg.predict_learned.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = LearnedPredictRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid learned-prediction request — ${where}${issue?.message ?? "provide a normalized entity id in `from`."}`,
      400
    );
  }

  try {
    const pool = getPool() as unknown as KgPool;
    const { from, predicate, limit } = parsed.data;

    const fromNode = await getNodeByNormalizedId(pool, from);
    if (!fromNode) {
      logEvent("kg.predict_learned.unknown_entity", { latencyMs: Date.now() - start });
      return ok({
        from,
        predicate: (predicate ?? "associates_with") as KgPredicate,
        predictions: [],
        trained: false,
        note: "That entity is not present in the knowledge graph, so no links can be predicted.",
      });
    }

    // Load existing embeddings; train on demand if none exist yet.
    let embeddings = await loadEmbeddings(pool);
    let trained = false;
    if (!embeddings) {
      const { trained: fresh, edgeCount } = await trainAndPersist(pool);
      trained = fresh.entities.size > 0;
      embeddings = fresh.entities.size > 0 ? fresh : null;
      if (!embeddings) {
        logEvent("kg.predict_learned.no_embeddings", {
          latencyMs: Date.now() - start,
          edgeCount,
        });
        return ok({
          from,
          predicate: (predicate ?? "associates_with") as KgPredicate,
          predictions: [],
          trained: false,
          note: "The knowledge graph has no edges to train embeddings on yet; learned prediction is unavailable.",
        });
      }
    }

    const result = await predictLearnedLinks(pool, fromNode, embeddings, { predicate, limit });

    const predictions = result.predictions.map((p) => ({
      subject: {
        id: p.subject.id,
        entityType: p.subject.entityType,
        name: p.subject.name,
        normalizedId: p.subject.normalizedId,
      },
      predicate: p.predicate,
      object: {
        id: p.object.id,
        entityType: p.object.entityType,
        name: p.object.name,
        normalizedId: p.object.normalizedId,
      },
      // Round the distance for a stable, presentable number; the full ordering is
      // already fixed by predictLearnedLinks (ascending distance, id tie-break).
      distance: Math.round(p.distance * 1e6) / 1e6,
    }));

    logEvent("kg.predict_learned.success", {
      latencyMs: Date.now() - start,
      predicate: predicate ?? "associates_with",
      predictionCount: predictions.length,
      trained,
    });

    return ok({
      from,
      predicate: (predicate ?? "associates_with") as KgPredicate,
      predictions,
      trained,
      note: result.note,
    });
  } catch (err) {
    logEvent("kg.predict_learned.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/kg/predict/learned] failed:", err);
    return fail(
      "Something went wrong while predicting learned links. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
