import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { isUuid } from "@/lib/reporting/types";
import { listRuns, countRuns, type RunFilters } from "@/lib/reporting/queries";

const RUN_STATUSES = new Set(["pending", "running", "complete", "failed"]);

// GET /api/report-runs — paginated list of the org's report runs, newest first.
// Optional ?definitionId and ?status filters. Any member may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);
    const url = new URL(req.url);

    const definitionId = url.searchParams.get("definitionId");
    if (definitionId && !isUuid(definitionId)) {
      return fail("Invalid definition id.", 400);
    }
    const status = url.searchParams.get("status");
    if (status && !RUN_STATUSES.has(status)) {
      return fail("Invalid run status.", 400);
    }

    const filters: RunFilters = {
      definitionId: definitionId ?? undefined,
      status: status ?? undefined,
    };

    const pool = getPool();
    const [runs, total] = await Promise.all([
      listRuns(pool, ctx.org.id, filters, limit, offset),
      countRuns(pool, ctx.org.id, filters),
    ]);
    return ok(runs, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load report runs.", 500);
  }
});
