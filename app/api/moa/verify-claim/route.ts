import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { ragFusionRetrieve } from "@/lib/retrieval/hybrid";
import { orchestrate } from "@/lib/moa/orchestrate";
import type { MoaSource } from "@/lib/moa/types";

// Public POST endpoint: claim -> RETRIEVE cached sources -> run the MIXTURE OF AGENTS.
// Given { claim }, it RAG-fusion-retrieves the most relevant cached sources server-side
// (their raw_text never crosses to the client), maps them into MoA sources, and runs the
// full composition pipeline. Returns the MoA result (verdict + trust + layered agent trace +
// grounded citation spans) plus a text-free summary of which sources were used.
//
// This is the one-input product flow: paste a claim, get a composed, cited verdict from all
// the backend engines — no manual source pasting. Source text is never logged or transported.
export const runtime = "nodejs";
export const maxDuration = 60;

const VerifyClaimRequestSchema = z.object({
  claim: z.string().trim().min(10, "claim must be at least 10 characters.").max(2000),
  limit: z.number().int().positive().max(20).optional(),
  options: z
    .object({
      llm: z.boolean().optional(),
      maxAgents: z.number().int().min(1).max(24).optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("moa.verify_claim.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = VerifyClaimRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid request — ${where}${issue?.message ?? "provide a claim of at least 10 characters."}`,
      400
    );
  }

  try {
    const { claim, limit, options } = parsed.data;

    // Retrieve cached sources server-side; raw_text stays here and never hits the client.
    const fusion = await ragFusionRetrieve(claim, limit !== undefined ? { finalLimit: limit } : {});
    const sources: MoaSource[] = fusion.hits
      .filter((h) => h.raw_text.trim().length > 0)
      .map((h) => ({
        id: h.id,
        text: h.raw_text,
        title: h.title ?? undefined,
        url: h.url || undefined,
      }));

    if (sources.length === 0) {
      // Honest empty state: nothing cached matched. No fabricated verdict.
      return ok({
        claim,
        retrieved: 0,
        sourcesUsed: [],
        facets: fusion.facets.map((f) => f.facet),
        result: null,
        message:
          "No cached sources matched this claim. Ingest sources for this topic (Source Ingest) and retry.",
      });
    }

    const result = await orchestrate({ claim, sources, options });

    logEvent("moa.verify_claim.success", {
      latencyMs: Date.now() - start,
      retrieved: sources.length,
      selected: result.agents.length,
      verdict: result.aggregate.verdict,
      trust: result.aggregate.trust,
      usedClaude: result.usedClaude,
    });

    // Text-free source summary for the UI (ids/titles/type only — never raw_text).
    const sourcesUsed = fusion.hits
      .filter((h) => h.raw_text.trim().length > 0)
      .map((h) => ({
        id: h.id,
        title: h.title,
        source_type: h.source_type,
        url: h.url || null,
      }));

    return ok({
      claim,
      retrieved: sources.length,
      sourcesUsed,
      facets: fusion.facets.map((f) => f.facet),
      result,
    });
  } catch (err) {
    logEvent("moa.verify_claim.error", { latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/moa/verify-claim] failed:", err);
    return fail(
      "Something went wrong while retrieving sources and running the mixture of agents. This has been logged — please try again.",
      500
    );
  }
}
