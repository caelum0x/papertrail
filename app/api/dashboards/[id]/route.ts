import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getPool } from "@/lib/db";
import {
  deleteDashboard,
  getDashboard,
  updateDashboard,
  updateDashboardSchema,
  type Dashboard,
} from "../repository";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isDuplicateName(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

// GET /api/dashboards/[id] — a single dashboard. Any member may read.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid dashboard id.", 400);
    }

    const dashboard = await getDashboard(ctx.org.id, id);
    if (!dashboard) {
      return fail("Dashboard not found.", 404);
    }
    return ok<Dashboard>(dashboard);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't load the dashboard. Please try again.", 500);
  }
});

// PATCH /api/dashboards/[id] — rename / re-layout / set default. Requires editor+.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid dashboard id.", 400);
    }

    const body = await req.json().catch(() => null);
    const parsed = updateDashboardSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const updated = await updateDashboard(ctx.org.id, id, parsed.data);
    if (!updated) {
      return fail("Dashboard not found.", 404);
    }

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "dashboard.update",
      entityType: "dashboard",
      entityId: id,
      metadata: { fields: Object.keys(parsed.data) },
    });

    return ok<Dashboard>(updated);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    if (isDuplicateName(err)) {
      return fail("A dashboard with that name already exists.", 409);
    }
    return fail("Couldn't update the dashboard. Please try again.", 500);
  }
});

// DELETE /api/dashboards/[id] — remove a dashboard (widgets cascade). Editor+.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid dashboard id.", 400);
    }

    const removed = await deleteDashboard(ctx.org.id, id);
    if (!removed) {
      return fail("Dashboard not found.", 404);
    }

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "dashboard.delete",
      entityType: "dashboard",
      entityId: id,
    });

    return ok({ deleted: true });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't delete the dashboard. Please try again.", 500);
  }
});
