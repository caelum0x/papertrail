import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { getBuiltinWorkflow } from "@/lib/workflows/registry";
import { getCustomWorkflow } from "@/lib/workflows/repository";

// GET /api/agent-workflows/[id] — a single workflow definition. The [id] segment
// is either a built-in key (e.g. "retrieve-extract-verify") or a custom workflow
// uuid. Built-ins resolve first, then org-scoped custom lookup. Any member reads.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id) {
      return fail("Missing workflow id.", 400);
    }

    const builtin = getBuiltinWorkflow(id);
    if (builtin) {
      return ok({
        id: builtin.key,
        source: "builtin" as const,
        name: builtin.name,
        description: builtin.description,
        definition: builtin,
      });
    }

    const custom = await getCustomWorkflow(getPool(), ctx.org.id, id);
    if (!custom) {
      return fail("Workflow not found.", 404);
    }
    return ok({
      id: custom.id,
      source: "custom" as const,
      name: custom.name,
      description: custom.description,
      definition: custom.definition,
      createdBy: custom.createdBy,
      createdAt: custom.createdAt,
    });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load workflow.", 500);
  }
});
