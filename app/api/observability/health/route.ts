import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { buildHealthReport } from "@/lib/observability/health";

export const runtime = "nodejs";

// GET /api/observability/health — composed health report (db reachability +
// build info + config checks). Any member (viewer+) may read.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const report = await buildHealthReport();
    return ok(report);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to build health report.", 500);
  }
});
