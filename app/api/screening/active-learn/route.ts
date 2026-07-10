// ORG-SCOPED compute route for NATIVE ASReview active-learning screening.
//
// Screening is tenant data (a systematic review's candidate records), so this route
// is org-scoped: withOrg resolves the caller's org + role, requireRole("editor")
// gates the mutation-adjacent triage action, and writeAudit records the run. It
// loads a project's sr_records via getPool, uses each record's current screening
// status as its active-learning label (title_included/fulltext_included → relevant,
// *_excluded → irrelevant, pending → unlabeled), fits the native TF-IDF + Naive
// Bayes model (lib/screening/activeLearning — no Python, no Claude), and returns the
// PENDING records ranked most-relevant-first so the reviewer screens the highest-
// value records next.
//
// Standard { success, data, error } envelope, IP rate-limited, Zod-validated body,
// and NEVER logs record text (only tenant-safe counts).

import { NextRequest } from "next/server";
import { z } from "zod";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { rankRecordsAL, type ALLabel, type ALRecord } from "@/lib/screening/activeLearning";

export const runtime = "nodejs";

// Request body: which review to rank, and how many pending records to return.
const ActiveLearnRequestSchema = z.object({
  projectId: z.string().uuid("A valid systematic-review project id is required."),
  limit: z.number().int().min(1).max(500).optional(),
});

// Screening statuses that carry an active-learning training signal. The remaining
// status ('pending') is the unlabeled pool the model ranks.
const RELEVANT_STATUSES = new Set(["title_included", "fulltext_included"]);
const IRRELEVANT_STATUSES = new Set(["title_excluded", "fulltext_excluded"]);

interface SrRecordRow {
  id: string;
  title: string;
  abstract: string | null;
  status: string;
}

/** Map a record's screening status to an active-learning label, or null if pending. */
function labelForStatus(status: string): 0 | 1 | null {
  if (RELEVANT_STATUSES.has(status)) return 1;
  if (IRRELEVANT_STATUSES.has(status)) return 0;
  return null;
}

export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  const start = Date.now();

  // Rate-limit per org+user so one tenant can't exhaust the shared instance.
  const rate = checkRateLimit(`screening-al:${ctx.org.id}:${ctx.user.id}`);
  if (!rate.allowed) {
    logEvent("screening.active_learn.rate_limited", { orgId: ctx.org.id });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  try {
    // Editor+ to run the ranking (it drives screening decisions for the team).
    requireRole(ctx, "editor");

    const json = await req.json().catch(() => null);
    const parsed = ActiveLearnRequestSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }
    const { projectId, limit } = parsed.data;

    const pool = getPool();

    // Ownership check: the project must belong to the caller's org. Never trust the
    // projectId alone — always scope by org_id.
    const project = await pool.query(
      `select id from sr_projects where id = $1 and org_id = $2`,
      [projectId, ctx.org.id]
    );
    if (project.rowCount === 0) {
      return fail("Systematic-review project not found.", 404);
    }

    // Load all records for the project (org-scoped). Both labeled (decided) and
    // pending records are needed: labeled train the model, pending get ranked.
    const { rows } = await pool.query<SrRecordRow>(
      `select id, title, abstract, status
         from sr_records
        where org_id = $1 and sr_project_id = $2`,
      [ctx.org.id, projectId]
    );

    const records: ALRecord[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      abstract: r.abstract ?? "",
    }));

    const labeled: ALLabel[] = [];
    for (const r of rows) {
      const label = labelForStatus(r.status);
      if (label !== null) {
        labeled.push({ id: r.id, label01: label });
      }
    }

    const result = rankRecordsAL(records, labeled);

    // The route surfaces only the PENDING records ranked most-relevant-first (the
    // reviewer's next-to-screen worklist), optionally truncated to `limit`. Enrich
    // with title so the console can render the worklist without a second fetch.
    const titleById = new Map(rows.map((r) => [r.id, r.title]));
    const ranked = result.ranking
      .slice(0, limit ?? result.ranking.length)
      .map((item) => ({
        id: item.id,
        title: titleById.get(item.id) ?? "",
        relevance: item.relevance,
      }));

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "screening.active_learn.ranked",
      entityType: "sr_project",
      entityId: projectId,
      metadata: {
        labeled: result.meta.labeled,
        relevantLabels: result.meta.relevantLabels,
        irrelevantLabels: result.meta.irrelevantLabels,
        unlabeled: result.meta.unlabeled,
        returned: ranked.length,
      },
    });

    logEvent("screening.active_learn.success", {
      orgId: ctx.org.id,
      latencyMs: Date.now() - start,
      labeled: result.meta.labeled,
      unlabeled: result.meta.unlabeled,
      vocabularySize: result.meta.vocabularySize,
      returned: ranked.length,
    });

    return ok({
      projectId,
      ranked,
      meta: result.meta,
    });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    logEvent("screening.active_learn.error", {
      orgId: ctx.org.id,
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/screening/active-learn] failed:", err);
    return fail(
      "Something went wrong while ranking screening records. This has been logged — please try again.",
      500
    );
  }
});
