import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getPool } from "@/lib/db";
import {
  deleteWidget,
  getWidget,
  updateWidget,
  updateWidgetSchema,
  type DashboardWidget,
} from "../../../repository";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateIds(
  dashboardId: string | undefined,
  widgetId: string | undefined
): { dashboardId: string; widgetId: string } | null {
  if (!dashboardId || !UUID_RE.test(dashboardId)) return null;
  if (!widgetId || !UUID_RE.test(widgetId)) return null;
  return { dashboardId, widgetId };
}

// GET /api/dashboards/[id]/widgets/[widgetId] — one widget. Any member reads.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const ids = validateIds(params?.id, params?.widgetId);
    if (!ids) return fail("Invalid dashboard or widget id.", 400);

    const widget = await getWidget(ctx.org.id, ids.dashboardId, ids.widgetId);
    if (!widget) return fail("Widget not found.", 404);
    return ok<DashboardWidget>(widget);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't load the widget. Please try again.", 500);
  }
});

// PATCH /api/dashboards/[id]/widgets/[widgetId] — reconfigure / reposition. Editor+.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const ids = validateIds(params?.id, params?.widgetId);
    if (!ids) return fail("Invalid dashboard or widget id.", 400);

    const body = await req.json().catch(() => null);
    const parsed = updateWidgetSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const updated = await updateWidget(
      ctx.org.id,
      ids.dashboardId,
      ids.widgetId,
      parsed.data
    );
    if (!updated) return fail("Widget not found.", 404);

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "dashboard_widget.update",
      entityType: "dashboard_widget",
      entityId: ids.widgetId,
      metadata: { dashboardId: ids.dashboardId, fields: Object.keys(parsed.data) },
    });

    return ok<DashboardWidget>(updated);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't update the widget. Please try again.", 500);
  }
});

// DELETE /api/dashboards/[id]/widgets/[widgetId] — remove a widget. Editor+.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const ids = validateIds(params?.id, params?.widgetId);
    if (!ids) return fail("Invalid dashboard or widget id.", 400);

    const removed = await deleteWidget(ctx.org.id, ids.dashboardId, ids.widgetId);
    if (!removed) return fail("Widget not found.", 404);

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "dashboard_widget.delete",
      entityType: "dashboard_widget",
      entityId: ids.widgetId,
      metadata: { dashboardId: ids.dashboardId },
    });

    return ok({ deleted: true });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't delete the widget. Please try again.", 500);
  }
});
