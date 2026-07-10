import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import {
  hybridSearch,
  RRF_K,
  SEMANTIC_WEIGHT,
  FULL_TEXT_WEIGHT,
  type HybridHit,
} from "@/lib/retrieval/hybrid";

// Public POST endpoint for HYBRID RETRIEVAL — a native port of R2R's hybrid_search
// (vector + full-text with Reciprocal Rank Fusion, plus optional graph expansion)
// over OUR cached `sources` table. Given a query string it returns the fused,
// best-first source hits with their RRF provenance (which ranks fed each score).
//
// Never logs the query text (may be unpublished research content) — only metadata
// needed to debug latency/failures.
export const runtime = "nodejs";

const RequestSchema = z.object({
  query: z.string().trim().min(1, "Enter a query.").max(1000),
  limit: z.number().int().min(1).max(50).optional(),
  expandGraph: z.boolean().optional(),
});

// Response DTO — a trimmed, transport-safe view of a HybridHit. The full raw_text is
// truncated to a snippet so the endpoint stays a retrieval index, not a bulk dump.
interface HybridResultDto {
  id: string;
  sourceType: string;
  externalId: string;
  title: string | null;
  url: string;
  snippet: string;
  rrfScore: number;
  semanticRank: number | null;
  fullTextRank: number | null;
  graphExpanded: boolean;
}

function snippet(text: string, max = 280): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 3)}...` : collapsed;
}

function toDto(hit: HybridHit): HybridResultDto {
  return {
    id: hit.id,
    sourceType: hit.source_type,
    externalId: hit.external_id,
    title: hit.title,
    url: hit.url,
    snippet: snippet(hit.raw_text),
    rrfScore: hit.rrfScore,
    semanticRank: hit.semanticRank,
    fullTextRank: hit.fullTextRank,
    graphExpanded: hit.graphExpanded,
  };
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("retrieval.hybrid.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid hybrid-search request — ${where}${issue?.message ?? "check your input."}`,
      400
    );
  }

  try {
    const hits = await hybridSearch(parsed.data.query, {
      finalLimit: parsed.data.limit,
      expandGraph: parsed.data.expandGraph,
    });

    logEvent("retrieval.hybrid.success", {
      latencyMs: Date.now() - start,
      numResults: hits.length,
      expandGraph: parsed.data.expandGraph ?? false,
    });

    return ok({
      results: hits.map(toDto),
      fusion: {
        method: "reciprocal_rank_fusion",
        rrfK: RRF_K,
        semanticWeight: SEMANTIC_WEIGHT,
        fullTextWeight: FULL_TEXT_WEIGHT,
      },
    });
  } catch (err) {
    logEvent("retrieval.hybrid.error", {
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : "unknown",
    });
    return fail("Hybrid retrieval failed. Please try again.", 500);
  }
}
