import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { checkRateLimit } from "@/lib/rateLimit";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logEvent } from "@/lib/logger";
import { getSrProject, listRecords } from "@/app/api/sr-projects/lib/repository";
import { aiRankRequestSchema } from "@/lib/screening/schemas";
import { aiRankRecords } from "@/lib/screening/aiRank";

export const runtime = "nodejs";

// POST /api/screening/ai-rank — AI active-learning screening.
// Org-scoped tenant data: withOrg resolves org from the session (never client
// org_id), requireRole(editor) gates it (ranking mutates the reviewer's worklist
// ordering), every DB read is org_id-first, and writeAudit records who ran it.
// Body: { projectId, limit? }. Ranks the review's PENDING records by relevance to
// its inclusion criteria and returns them most-likely-relevant first. Records are
// tenant data — we log counts/latency only, never title or abstract text.
//
// Per-org rate budget: AI ranking fans out many Claude calls (one per batch of 25
// abstracts), making it far more expensive than a single verify. The same per-org
// bucket pattern as copilot/data-chat caps abuse per tenant without blocking
// legitimate single-invocation use.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  const start = Date.now();
  try {
    requireRole(ctx, "editor");

    // Per-org rate limit: batched Claude screening is expensive — cap per tenant.
    const rate = checkRateLimit(`ai-rank:${ctx.org.id}`, { max: 10 });
    if (!rate.allowed) {
      logEvent("screening.ai_rank.rate_limited", { orgId: ctx.org.id });
      return fail("Rate limit reached. Please wait a moment before re-ranking.", 429);
    }

    const json = await req.json().catch(() => null);
    const parsed = aiRankRequestSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }
    const { projectId, limit } = parsed.data;

    const pool = getPool();

    // org_id-first read: getSrProject filters by ctx.org.id, so a caller can never
    // rank another tenant's review even by guessing a project id.
    const project = await getSrProject(pool, ctx.org.id, projectId);
    if (!project) {
      return fail("Systematic review not found.", 404);
    }

    // Only PENDING records need triage — already-screened records have a decision.
    const { items } = await listRecords(pool, {
      orgId: ctx.org.id,
      srProjectId: projectId,
      status: "pending",
      limit: limit ?? 200,
      offset: 0,
    });

    if (items.length === 0) {
      logEvent("screening.ai_rank.empty", {
        orgId: ctx.org.id,
        projectId,
        latencyMs: Date.now() - start,
      });
      return ok({ ranked: [], unrankedCount: 0, rankedCount: 0 });
    }

    const { ranked, unrankedIds } = await aiRankRecords({
      criteria: project.inclusionCriteria,
      records: items.map((r) => ({
        id: r.id,
        title: r.title,
        abstract: r.abstract,
      })),
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "screening.ai_ranked",
      entityType: "sr_project",
      entityId: projectId,
      // Counts only — never record titles or abstracts in the audit trail.
      metadata: {
        candidateCount: items.length,
        rankedCount: ranked.length,
        unrankedCount: unrankedIds.length,
        groundedCount: ranked.filter((r) => r.groundingOk).length,
      },
    });

    logEvent("screening.ai_rank.success", {
      orgId: ctx.org.id,
      projectId,
      candidateCount: items.length,
      rankedCount: ranked.length,
      unrankedCount: unrankedIds.length,
      latencyMs: Date.now() - start,
    });

    return ok({
      ranked,
      rankedCount: ranked.length,
      unrankedCount: unrankedIds.length,
    });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    logEvent("screening.ai_rank.error", {
      orgId: ctx.org.id,
      latencyMs: Date.now() - start,
      error: String(err),
    });
    return fail(
      "AI ranking failed. This has been logged — please try again.",
      500
    );
  }
});
