import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getPool } from "@/lib/db";
import {
  createWidget,
  createWidgetSchema,
  getDashboard,
  listWidgets,
  type DashboardWidget,
} from "../../repository";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/dashboards/[id]/widgets — all widgets on a dashboard. Any member reads.
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
    return ok<DashboardWidget[]>(widgets);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't load widgets. Please try again.", 500);
  }
});

// POST /api/dashboards/[id]/widgets — add a widget. Requires editor+.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const dashboardId = params?.id;
    if (!dashboardId || !UUID_RE.test(dashboardId)) {
      return fail("Invalid dashboard id.", 400);
    }

    const dashboard = await getDashboard(ctx.org.id, dashboardId);
    if (!dashboard) {
      return fail("Dashboard not found.", 404);
    }

    const body = await req.json().catch(() => null);
    const parsed = createWidgetSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const widget = await createWidget(ctx.org.id, dashboardId, parsed.data);

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "dashboard_widget.create",
      entityType: "dashboard_widget",
      entityId: widget.id,
      metadata: { dashboardId, kind: widget.kind },
    });

    return created<DashboardWidget>(widget);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't add the widget. Please try again.", 500);
  }
});
