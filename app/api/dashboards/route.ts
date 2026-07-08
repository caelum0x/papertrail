import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getPool } from "@/lib/db";
import {
  createDashboard,
  createDashboardSchema,
  listDashboards,
  type Dashboard,
} from "./repository";

export const runtime = "nodejs";

function isDuplicateName(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

// GET /api/dashboards — paginated list of the org's dashboards. Any member reads.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listDashboards(ctx.org.id, limit, offset);
    return ok<Dashboard[]>(items, { total, page, limit });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't load dashboards. Please try again.", 500);
  }
});

// POST /api/dashboards — create a dashboard. Requires editor+.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const body = await req.json().catch(() => null);
    const parsed = createDashboardSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const dashboard = await createDashboard({
      orgId: ctx.org.id,
      createdBy: ctx.user.id,
      ...parsed.data,
    });

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "dashboard.create",
      entityType: "dashboard",
      entityId: dashboard.id,
      metadata: { name: dashboard.name, isDefault: dashboard.is_default },
    });

    return created<Dashboard>(dashboard);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    if (isDuplicateName(err)) {
      return fail("A dashboard with that name already exists.", 409);
    }
    return fail("Couldn't create the dashboard. Please try again.", 500);
  }
});
