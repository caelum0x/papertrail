import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getDashboard, listWidgets } from "../../repository";
import { resolveDashboardData, type ResolvedWidget } from "../../resolver";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DashboardData {
  dashboardId: string;
  name: string;
  widgets: ResolvedWidget[];
}

// GET /api/dashboards/[id]/data — resolve every widget's metric, strictly
// org-scoped. Any member may read. One failing widget degrades to a per-widget
// error rather than failing the whole response.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const dashboardId = params?.id;
    if (!dashboardId || !UUID_RE.test(dashboardId)) {
      return fail("Invalid dashboard id.", 400);
    }

    const dashboard = await getDashboard(ctx.org.id, dashboardId);
    if (!dashboard) {
      return fail("Dashboard not found.", 404);
    }

    const widgets = await listWidgets(ctx.org.id, dashboardId);
    const resolved = await resolveDashboardData(ctx.org.id, widgets);

    return ok<DashboardData>({
      dashboardId,
      name: dashboard.name,
      widgets: resolved,
    });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't load dashboard data. Please try again.", 500);
  }
});
