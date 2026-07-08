import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { getRunDetail, isUuid } from "@/lib/workflows/repository";

// GET /api/agent-runs/[id] — a single run with its full step trace. Org-scoped.
// Any member (viewer+) may read.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !isUuid(id)) {
      return fail("Invalid run id.", 400);
    }

    const run = await getRunDetail(getPool(), ctx.org.id, id);
    if (!run) {
      return fail("Run not found.", 404);
    }
    return ok(run);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load run.", 500);
  }
});
