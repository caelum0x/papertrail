import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import { createMonitorSchema } from "@/lib/monitoring/schemas";
import { listMonitors, createMonitor } from "@/lib/monitoring/repo";

export const runtime = "nodejs";

function rbacStatus(err: unknown): number | null {
  if (
    err instanceof Error &&
    typeof (err as unknown as { status?: unknown }).status === "number"
  ) {
    return (err as unknown as { status: number }).status;
  }
  return null;
}

// GET /api/monitors — paginated, org-scoped list of literature monitors.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const url = new URL(req.url);
    const projectRaw = url.searchParams.get("project_id");
    const enabledRaw = url.searchParams.get("enabled");

    const { items, total } = await listMonitors({
      orgId: ctx.org.id,
      limit,
      offset,
      projectId:
        projectRaw && projectRaw.trim().length > 0 ? projectRaw.trim() : undefined,
      enabled:
        enabledRaw === "true" ? true : enabledRaw === "false" ? false : undefined,
    });

    return ok(items, { total, page, limit });
  } catch {
    return fail("Couldn't load monitors. Please try again.", 500);
  }
});

// POST /api/monitors — create a scheduled safety-literature monitor.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const body = await req.json().catch(() => null);
    const parsed = createMonitorSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid monitor.", 400);
    }

    const monitor = await createMonitor({ ...parsed.data, orgId: ctx.org.id });

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "monitor.create",
      entityType: "monitor",
      entityId: monitor.id,
      metadata: { name: monitor.name, frequency: monitor.frequency },
    });

    return created(monitor);
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't create the monitor. Please try again.", 500);
  }
});
