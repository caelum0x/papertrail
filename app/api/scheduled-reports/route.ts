import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { createScheduleSchema } from "@/lib/reporting/types";
import {
  listSchedules,
  countSchedules,
  createSchedule,
  getDefinition,
  findScheduleByDefinition,
} from "@/lib/reporting/queries";

// GET /api/scheduled-reports — paginated list of the org's scheduled reports,
// newest first. Any member may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);
    const pool = getPool();
    const [schedules, total] = await Promise.all([
      listSchedules(pool, ctx.org.id, limit, offset),
      countSchedules(pool, ctx.org.id),
    ]);
    return ok(schedules, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load scheduled reports.", 500);
  }
});

// POST /api/scheduled-reports — attach a cron + recipients to a definition
// (editor+). The definition must belong to the org, and a definition may only
// have one schedule. Audited.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const raw = await req.json().catch(() => null);
    const parsed = createScheduleSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();

    // Verify the target definition is org-scoped before scheduling it.
    const definition = await getDefinition(pool, ctx.org.id, parsed.data.definitionId);
    if (!definition) {
      return fail("Report not found.", 404);
    }

    const existing = await findScheduleByDefinition(
      pool,
      ctx.org.id,
      parsed.data.definitionId
    );
    if (existing) {
      return fail("This report is already scheduled.", 409);
    }

    const schedule = await createSchedule(pool, {
      orgId: ctx.org.id,
      definitionId: parsed.data.definitionId,
      createdBy: ctx.user.id,
      cron: parsed.data.cron,
      recipients: parsed.data.recipients,
      enabled: parsed.data.enabled ?? true,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "scheduled_report.create",
      entityType: "scheduled_report",
      entityId: schedule.id,
      metadata: {
        definitionId: schedule.definitionId,
        cron: schedule.cron,
        enabled: schedule.enabled,
        recipientCount: schedule.recipients.length,
      },
    });

    return created(schedule);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create scheduled report.", 500);
  }
});
