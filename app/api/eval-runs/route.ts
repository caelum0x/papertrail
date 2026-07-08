import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { createEvalRunSchema } from "@/lib/eval/schemas";
import { listEvalRuns, getEvalSet } from "@/lib/eval/queries";
import { runEvalSet } from "@/lib/eval/runner";

export const runtime = "nodejs";
// Running a set drives the full LLM pipeline over every case; give it room.
export const maxDuration = 300;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/eval-runs — list runs for the org, optionally filtered by eval_set_id
// (?eval_set_id=). Paginated, newest first. Any member (viewer+) may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const url = new URL(req.url);
    const evalSetId = url.searchParams.get("eval_set_id") ?? undefined;
    if (evalSetId && !UUID_RE.test(evalSetId)) {
      return fail("Invalid eval_set_id.", 400);
    }

    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listEvalRuns(getPool(), {
      orgId: ctx.org.id,
      evalSetId,
      limit,
      offset,
    });
    return ok(items, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load eval runs.", 500);
  }
});

// POST /api/eval-runs — run an eval set through the verification pipeline, score
// every case, and store the run + per-case results. Editors and above.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");
    const json = await req.json().catch(() => null);
    const parsed = createEvalRunSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const pool = getPool();
    const set = await getEvalSet(pool, ctx.org.id, parsed.data.eval_set_id);
    if (!set) {
      return fail("Eval set not found.", 404);
    }
    if ((set.caseCount ?? 0) === 0) {
      return fail("This eval set has no cases to run. Add at least one case first.", 400);
    }

    const run = await runEvalSet(pool, {
      orgId: ctx.org.id,
      evalSetId: parsed.data.eval_set_id,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "eval_run.created",
      entityType: "eval_run",
      entityId: run.id,
      metadata: {
        evalSetId: run.evalSetId,
        status: run.status,
        accuracy: run.accuracy,
        totalCases: run.summary.totalCases,
      },
    });

    return created(run);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to run eval set.", 500);
  }
});
