import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { createScheduleSchema } from "@/lib/jobs/schemas";
import {
  listSchedules,
  createSchedule,
  typeIsRunnable,
} from "@/lib/jobs/scheduleRepository";

// GET /api/schedules — list cron-like schedules for the org, paginated. Any
// member (viewer+) may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");

    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listSchedules(getPool(), {
      orgId: ctx.org.id,
      limit,
      offset,
    });

    return ok(items, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load schedules.", 500);
  }
});

// POST /api/schedules — create a schedule. Managing recurring work is an admin
// action.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");

    const json = await req.json().catch(() => null);
    const parsed = createScheduleSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    if (!typeIsRunnable(parsed.data.type)) {
      return fail(
        `No handler registered for job type "${parsed.data.type}".`,
        400
      );
    }

    const pool = getPool();
    const schedule = await createSchedule(pool, {
      orgId: ctx.org.id,
      name: parsed.data.name,
      type: parsed.data.type,
      cron: parsed.data.cron,
      payload: parsed.data.payload ?? {},
      enabled: parsed.data.enabled ?? true,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "schedule.created",
      entityType: "schedule",
      entityId: schedule.id,
      metadata: { name: schedule.name, type: schedule.type, cron: schedule.cron },
    });

    return created(schedule);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create schedule.", 500);
  }
});
