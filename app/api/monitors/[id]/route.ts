import { NextRequest } from "next/server";
import { z } from "zod";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import { updateMonitorSchema } from "@/lib/monitoring/schemas";
import { updateMonitor, deleteMonitor } from "@/lib/monitoring/repo";

export const runtime = "nodejs";

const idSchema = z.string().uuid();

function rbacStatus(err: unknown): number | null {
  if (
    err instanceof Error &&
    typeof (err as unknown as { status?: unknown }).status === "number"
  ) {
    return (err as unknown as { status: number }).status;
  }
  return null;
}

// PATCH /api/monitors/[id] — update a monitor's config (name, query, sources,
// frequency, enabled).
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");

    const parsedId = idSchema.safeParse(params?.id);
    if (!parsedId.success) {
      return fail("Invalid monitor id.", 400);
    }

    const body = await req.json().catch(() => null);
    const parsed = updateMonitorSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid update.", 400);
    }

    const updated = await updateMonitor(ctx.org.id, parsedId.data, parsed.data);
    if (!updated) {
      return fail("Monitor not found.", 404);
    }

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "monitor.update",
      entityType: "monitor",
      entityId: updated.id,
      metadata: { fields: Object.keys(parsed.data) },
    });

    return ok(updated);
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't update the monitor. Please try again.", 500);
  }
});

// DELETE /api/monitors/[id] — remove a monitor and its hits (cascade).
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");

    const parsed = idSchema.safeParse(params?.id);
    if (!parsed.success) {
      return fail("Invalid monitor id.", 400);
    }

    const removed = await deleteMonitor(ctx.org.id, parsed.data);
    if (!removed) {
      return fail("Monitor not found.", 404);
    }

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "monitor.delete",
      entityType: "monitor",
      entityId: parsed.data,
    });

    return ok({ id: parsed.data, deleted: true });
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't delete the monitor. Please try again.", 500);
  }
});
