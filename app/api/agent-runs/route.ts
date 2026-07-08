import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { startRunSchema, runsQuerySchema } from "@/lib/workflows/schemas";
import { listRuns } from "@/lib/workflows/repository";
import { runWorkflow } from "@/lib/workflows/runner";

// GET /api/agent-runs — list workflow runs for the org, newest first. Optional
// status / workflowKey filters. Paginated. Any member (viewer+) may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");

    const url = new URL(req.url);
    const parsed = runsQuerySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
      workflowKey: url.searchParams.get("workflowKey") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid query.", 400);
    }

    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listRuns(getPool(), {
      orgId: ctx.org.id,
      status: parsed.data.status,
      workflowKey: parsed.data.workflowKey,
      limit,
      offset,
    });

    return ok(items, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load runs.", 500);
  }
});

// POST /api/agent-runs — start a run of a built-in or custom workflow against a
// claim. Executes synchronously and returns the full trace. Editor+ (running a
// pipeline spends API credits, so it's a mutation-level action).
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const json = await req.json().catch(() => null);
    const parsed = startRunSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const result = await runWorkflow(
      parsed.data.workflowKey,
      {
        claim: parsed.data.claim,
        preferExternalId: parsed.data.preferExternalId ?? undefined,
      },
      ctx
    );

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "agent_run.started",
      entityType: "agent_run",
      entityId: result.runId,
      metadata: { workflowKey: result.workflowKey, status: result.status },
    });

    return created(result);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to start run.", 500);
  }
});
