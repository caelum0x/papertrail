import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import {
  evidenceReportAnalytics,
  type EvidenceReportAnalytics,
} from "@/lib/evidenceReports/analytics";

export const runtime = "nodejs";

// GET /api/analytics/evidence-reports — at-a-glance analytics over an org's saved
// evidence reports: total, certainty distribution, verdict breakdown, recent
// reports, and reports-per-month. Org-scoped via ctx.org.id; any member may read.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const analytics = await evidenceReportAnalytics(getPool(), {
      orgId: ctx.org.id,
    });
    return ok<EvidenceReportAnalytics>(analytics);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't load evidence-report analytics. Please try again.", 500);
  }
});
