import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { getJob, retryJob } from "@/lib/jobs/queue";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/jobs/[id]/retry — re-queue a failed/completed job. Editor+.
export const POST = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid job id.", 400);
    }

    const pool = getPool();
    const existing = await getJob(pool, ctx.org.id, id);
    if (!existing) {
      return fail("Job not found.", 404);
    }
    if (existing.status === "running" || existing.status === "queued") {
      return fail("Only failed or completed jobs can be retried.", 409);
    }

    const job = await retryJob(pool, ctx.org.id, id);
    if (!job) {
      return fail("Only failed or completed jobs can be retried.", 409);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "job.retried",
      entityType: "job",
      entityId: job.id,
      metadata: { type: job.type },
    });

    return ok(job);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to retry job.", 500);
  }
});
