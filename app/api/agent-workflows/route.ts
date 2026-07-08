import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { createWorkflowSchema } from "@/lib/workflows/schemas";
import { listBuiltinWorkflows, isBuiltinKey } from "@/lib/workflows/registry";
import { listCustomWorkflows, createCustomWorkflow } from "@/lib/workflows/repository";

// GET /api/agent-workflows — the built-in pipelines plus this org's custom
// workflows. Any member (viewer+) may read. Pagination applies to custom
// workflows; built-ins are always returned in full as the `builtin` field.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");

    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listCustomWorkflows(
      getPool(),
      ctx.org.id,
      limit,
      offset
    );

    return ok(
      { builtin: listBuiltinWorkflows(), custom: items },
      { total, page, limit }
    );
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load workflows.", 500);
  }
});

// POST /api/agent-workflows — save a custom pipeline for the org. Editor+.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const json = await req.json().catch(() => null);
    const parsed = createWorkflowSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    // Custom keys must not shadow a built-in pipeline key.
    if (isBuiltinKey(parsed.data.definition.key)) {
      return fail(
        "That workflow key is reserved by a built-in pipeline. Choose another key.",
        409
      );
    }

    const pool = getPool();
    const workflow = await createCustomWorkflow(pool, {
      orgId: ctx.org.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      definition: parsed.data.definition,
      createdBy: ctx.user.id,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "agent_workflow.created",
      entityType: "agent_workflow",
      entityId: workflow.id,
      metadata: { key: workflow.definition.key, name: workflow.name },
    });

    return created(workflow);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create workflow.", 500);
  }
});
