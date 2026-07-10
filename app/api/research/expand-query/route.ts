import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import {
  ragFusionRetrieve,
  type RagFusionHit,
} from "@/lib/retrieval/hybrid";
import {
  evidenceSufficiency,
  type EvidenceSufficiencyResult,
} from "@/lib/evidencePipeline";
import { autoSynthesize } from "@/lib/autoSynthesis";

// Public POST endpoint for QUERY EXPANSION (RAG-FUSION) + EVIDENCE-SUFFICIENCY.
// Given { query }, it:
//   1. DECOMPOSES the query into four biomedical facets (efficacy / safety /
//      mechanism / subgroup) — a fixed, deterministic template, NOT an LLM step.
//   2. Runs the EXISTING hybrid retrieval per facet and FUSES the rankings with
//      Reciprocal Rank Fusion (deterministic) — see lib/retrieval/hybrid.ts.
//   3. Deterministically auto-synthesises the fused sources and runs the
//      EVIDENCE-SUFFICIENCY gate (>= 3 studies, >= 100 participants, I² < 75%,
//      contradictions resolved) to decide whether there's enough to conclude.
//
// NO LLM touches any ranking, fusion, numeric, or verdict step. Mirrors /api/verify:
// nodejs runtime, IP rate-limited, Zod-validated input, {success,data,error}
// envelope, try/catch. Never logs query or source text (only lengths / counts), per
// the "no claim/source text or API keys in logs" convention.
export const runtime = "nodejs";

const ExpandQueryRequestSchema = z.object({
  query: z.string().trim().min(10).max(2000),
  // Optional cap on fused sources folded into synthesis (retrieval applies its own
  // hard ceiling). Defaults to the retriever's own final limit when omitted.
  limit: z.number().int().positive().max(20).optional(),
  // Optional count of contradictions between sources that remain unresolved. The
  // sufficiency gate requires 0 open contradictions to conclude; callers that have
  // run contradiction resolution can pass the residual count. Defaults to 0.
  openContradictions: z.number().int().nonnegative().max(1000).optional(),
});

// Map one fused hybrid hit into the structural source the deterministic
// auto-synthesiser consumes. Pure: builds a new object, mutates nothing.
function toSynthesisSource(hit: RagFusionHit) {
  return {
    id: hit.id,
    source_type: hit.source_type,
    title: hit.title,
    raw_text: hit.raw_text,
    registered_results: hit.registered_results,
  };
}

// Sum participant counts across the fused sources. enrollment_count is null for
// records without a posted enrollment (e.g. many PubMed rows); those contribute 0
// rather than a fabricated headcount.
function sumParticipants(hits: readonly RagFusionHit[]): number {
  return hits.reduce(
    (acc, h) =>
      acc + (typeof h.enrollment_count === "number" ? h.enrollment_count : 0),
    0
  );
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("research.expand_query.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = ExpandQueryRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid expand-query request — ${where}${
        issue?.message ?? "provide a query of at least 10 characters."
      }`,
      400
    );
  }

  try {
    const { query, limit, openContradictions } = parsed.data;

    // 1 + 2. Decompose into facets and fuse per-facet hybrid retrieval (RRF).
    const fusion = await ragFusionRetrieve(
      query,
      limit !== undefined ? { finalLimit: limit } : {}
    );
    const hits = fusion.hits;

    // 3. Deterministic synthesis over the fused sources (drops any source with no
    //    poolable ratio-with-CI effect into `skipped`, never fabricating a number).
    const synthesis =
      hits.length > 0
        ? autoSynthesize({
            claim: query,
            sources: hits.map(toSynthesisSource),
          })
        : { studies: [], skipped: [], report: null };

    // Pull the deterministic pooled numbers for the sufficiency gate. When the
    // report is insufficient (or absent), k=0 / iSquared=null flow through as
    // honest failed criteria rather than being papered over.
    const pooledStudies =
      synthesis.report && synthesis.report.ok ? synthesis.report.pooled.k : 0;
    const iSquared =
      synthesis.report && synthesis.report.ok
        ? synthesis.report.pooled.heterogeneity.iSquared
        : null;

    const sufficiency: EvidenceSufficiencyResult = evidenceSufficiency({
      pooledStudies,
      totalParticipants: sumParticipants(hits),
      iSquared,
      openContradictions: openContradictions ?? 0,
    });

    logEvent("research.expand_query.success", {
      latencyMs: Date.now() - start,
      facets: fusion.facets.length,
      fusedSources: hits.length,
      pooledStudies,
      sufficient: sufficiency.sufficient,
    });

    return ok({
      // Facet decomposition (queries + cues) — the expansion trail.
      facets: fusion.facets,
      // Fused sources with per-facet provenance (which facets ranked each, at what
      // rank) and the fused RRF score. raw_text is intentionally omitted from the
      // response summary to keep source text out of transport/logs.
      sources: hits.map((h) => ({
        id: h.id,
        source_type: h.source_type,
        external_id: h.external_id,
        title: h.title,
        url: h.url,
        phase: h.phase,
        enrollment_count: h.enrollment_count,
        rrfScore: h.rrfScore,
        facetRanks: h.facetRanks,
      })),
      // Deterministic sufficiency verdict + the exact reasons any criterion failed.
      sufficiency,
    });
  } catch (err) {
    logEvent("research.expand_query.error", {
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "unknown",
    });
    console.error("[/api/research/expand-query] failed:", err);
    return fail(
      "Something went wrong while expanding the query and assessing evidence sufficiency. This has been logged — please try again or narrow the query.",
      500
    );
  }
}
