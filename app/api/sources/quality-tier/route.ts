import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import {
  scoreSourceQualityBatch,
  type SourceQualityMeta,
  type SourceQualityResult,
  type SourceQualityTier,
} from "@/lib/paperqa/sourceQuality";

// Public POST endpoint for SOURCE-QUALITY TIERING. Given a batch of source metadata
// (id, journal, year, citations, is_preprint, is_open_access, retracted) it returns a
// DETERMINISTIC tier (A/B/C/D) + a quality-weight in [0, 1] + a rationale per source.
// The weight lets synthesis down-weight low-tier evidence; a retracted source (explicit
// flag or a Retraction Watch id) hard-caps to Tier D / weight 0 and can never support a
// claim. No LLM is in the loop — tier and weight are a pure function of the metadata,
// mirroring backend/engines/paper-qa/papertrail_source_quality.py. Mirrors the other
// public compute routes: nodejs runtime, IP rate limit, ok/fail envelope, try/catch.
// NEVER logs claim/source text — only ids and counts.
export const runtime = "nodejs";

const SourceMetaSchema = z.object({
  id: z.string().trim().min(1),
  journal: z.string().nullish(),
  year: z.number().int().nullish(),
  citations: z.number().int().nonnegative().nullish(),
  is_preprint: z.boolean().nullish(),
  is_open_access: z.boolean().nullish(),
  retracted: z.boolean().nullish(),
  retraction_watch_id: z.string().nullish(),
});

const QualityTierRequestSchema = z.object({
  sources: z.array(SourceMetaSchema).min(1).max(200),
});

interface QualityTierResponse {
  tiers: SourceQualityResult[];
  count: number;
  // Corpus-level tier histogram (counts only) — safe to log and surface in the UI.
  tierCounts: Record<SourceQualityTier, number>;
  retractedCount: number;
}

function summarizeTiers(tiers: readonly SourceQualityResult[]): {
  tierCounts: Record<SourceQualityTier, number>;
  retractedCount: number;
} {
  const tierCounts: Record<SourceQualityTier, number> = { A: 0, B: 0, C: 0, D: 0 };
  let retractedCount = 0;
  for (const t of tiers) {
    tierCounts[t.tier] += 1;
    if (t.retracted) retractedCount += 1;
  }
  return { tierCounts, retractedCount };
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("sources.quality_tier.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = QualityTierRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid quality-tier request — ${where}${issue?.message ?? "provide a non-empty 'sources' array, each with an 'id'."}`,
      400
    );
  }

  try {
    // The schema-validated data is structurally the input type; the cast is safe and
    // keeps the compute layer free of Zod (deterministic, no I/O, no LLM).
    const metas = parsed.data.sources as SourceQualityMeta[];
    const tiers = scoreSourceQualityBatch(metas);
    const { tierCounts, retractedCount } = summarizeTiers(tiers);

    const result: QualityTierResponse = {
      tiers,
      count: tiers.length,
      tierCounts,
      retractedCount,
    };

    logEvent("sources.quality_tier.success", {
      latencyMs: Date.now() - start,
      count: tiers.length,
      tierA: tierCounts.A,
      tierB: tierCounts.B,
      tierC: tierCounts.C,
      tierD: tierCounts.D,
      retractedCount,
    });

    return ok(result);
  } catch (err) {
    logEvent("sources.quality_tier.error", {
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/sources/quality-tier] failed:", err);
    return fail(
      "Something went wrong while tiering source quality. This has been logged — please check your inputs and try again.",
      500
    );
  }
}
