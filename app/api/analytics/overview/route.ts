import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getOverviewMetrics, type OverviewMetrics } from "../queries";

export const runtime = "nodejs";

// GET /api/analytics/overview — org-level KPIs: claims verified, verification
// count, documents processed, average trust score, and distortion-rate by type.
// Any member may read.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const metrics = await getOverviewMetrics(ctx.org.id);
    return ok<OverviewMetrics>(metrics);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't load analytics overview. Please try again.", 500);
  }
});
