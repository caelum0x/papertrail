import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { processTick } from "@/lib/jobs/queue";

// POST /api/jobs/tick — process due schedules then drain the runnable queue for
// this org. Intended to be hit by a cron trigger (e.g. Vercel Cron) with the
// org selected via the x-org-id header. Admin-only, since it executes work.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");

    const url = new URL(req.url);
    const rawMax = Number(url.searchParams.get("maxJobs"));
    const maxJobs =
      Number.isFinite(rawMax) && rawMax >= 1 ? Math.floor(rawMax) : undefined;

    const pool = getPool();
    const result = await processTick(pool, { orgId: ctx.org.id, maxJobs });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "jobs.tick",
      entityType: "job",
      metadata: { ...result },
    });

    return ok(result);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to process jobs tick.", 500);
  }
});
