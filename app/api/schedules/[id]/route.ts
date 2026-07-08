import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { updateScheduleSchema } from "@/lib/jobs/schemas";
import {
  getSchedule,
  updateSchedule,
  deleteSchedule,
} from "@/lib/jobs/scheduleRepository";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PATCH /api/schedules/[id] — edit name/cron/payload/enabled. Admin-only.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid schedule id.", 400);
    }

    const json = await req.json().catch(() => null);
    const parsed = updateScheduleSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const pool = getPool();
    const existing = await getSchedule(pool, ctx.org.id, id);
    if (!existing) {
      return fail("Schedule not found.", 404);
    }

    const updated = await updateSchedule(pool, ctx.org.id, id, {
      name: parsed.data.name,
      cron: parsed.data.cron,
      payload: parsed.data.payload,
      enabled: parsed.data.enabled,
    });
    if (!updated) {
      return fail("Schedule not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "schedule.updated",
      entityType: "schedule",
      entityId: id,
      metadata: { enabled: updated.enabled, cron: updated.cron },
    });

    return ok(updated);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to update schedule.", 500);
  }
});

// DELETE /api/schedules/[id] — remove a schedule. Admin-only.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid schedule id.", 400);
    }

    const pool = getPool();
    const removed = await deleteSchedule(pool, ctx.org.id, id);
    if (!removed) {
      return fail("Schedule not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "schedule.deleted",
      entityType: "schedule",
      entityId: id,
    });

    return ok({ id, deleted: true });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to delete schedule.", 500);
  }
});
