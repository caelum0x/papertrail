import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { isUuid } from "@/lib/reporting/types";
import { getRun } from "@/lib/reporting/queries";

// GET /api/report-runs/[id] — fetch a single run (with its composed result) in
// the org. Any member may read.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!isUuid(id)) {
      return fail("Invalid run id.", 400);
    }
    const pool = getPool();
    const run = await getRun(pool, ctx.org.id, id);
    if (!run) {
      return fail("Run not found.", 404);
    }
    return ok(run);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load report run.", 500);
  }
});
