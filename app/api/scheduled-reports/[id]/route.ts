import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { updateScheduleSchema, isUuid } from "@/lib/reporting/types";
import {
  getSchedule,
  updateSchedule,
  deleteSchedule,
} from "@/lib/reporting/queries";

// GET /api/scheduled-reports/[id] — fetch a single schedule in the org.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!isUuid(id)) {
      return fail("Invalid schedule id.", 400);
    }
    const pool = getPool();
    const schedule = await getSchedule(pool, ctx.org.id, id);
    if (!schedule) {
      return fail("Schedule not found.", 404);
    }
    return ok(schedule);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load scheduled report.", 500);
  }
});

// PATCH /api/scheduled-reports/[id] — retune cron, recipients, or enabled flag
// (editor+). Audited.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!isUuid(id)) {
      return fail("Invalid schedule id.", 400);
    }

    const raw = await req.json().catch(() => null);
    const parsed = updateScheduleSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const existing = await getSchedule(pool, ctx.org.id, id);
    if (!existing) {
      return fail("Schedule not found.", 404);
    }

    const updated = await updateSchedule(pool, ctx.org.id, id, {
      cron: parsed.data.cron,
      recipients: parsed.data.recipients,
      enabled: parsed.data.enabled,
    });
    if (!updated) {
      return fail("Schedule not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "scheduled_report.update",
      entityType: "scheduled_report",
      entityId: id,
      metadata: {
        cron: updated.cron,
        enabled: updated.enabled,
        recipientCount: updated.recipients.length,
      },
    });

    return ok(updated);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to update scheduled report.", 500);
  }
});

// DELETE /api/scheduled-reports/[id] — remove a schedule (editor+). Audited.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!isUuid(id)) {
      return fail("Invalid schedule id.", 400);
    }

    const pool = getPool();
    const existing = await getSchedule(pool, ctx.org.id, id);
    if (!existing) {
      return fail("Schedule not found.", 404);
    }

    const removed = await deleteSchedule(pool, ctx.org.id, id);
    if (!removed) {
      return fail("Schedule not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "scheduled_report.delete",
      entityType: "scheduled_report",
      entityId: id,
      metadata: { definitionId: existing.definitionId },
    });

    return ok({ id, deleted: true });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to delete scheduled report.", 500);
  }
});
