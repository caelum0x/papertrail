import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { enqueueJobSchema, jobsQuerySchema } from "@/lib/jobs/schemas";
import { listJobs, enqueue } from "@/lib/jobs/queue";

// GET /api/jobs — the queue monitor. Optional status/type filters, paginated.
// Any member (viewer+) may read the queue.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");

    const url = new URL(req.url);
    const parsed = jobsQuerySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
      type: url.searchParams.get("type") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid query.", 400);
    }

    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listJobs(getPool(), {
      orgId: ctx.org.id,
      status: parsed.data.status,
      type: parsed.data.type,
      limit,
      offset,
    });

    return ok(items, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load jobs.", 500);
  }
});

// POST /api/jobs — enqueue a job. Editors and above may enqueue work.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const json = await req.json().catch(() => null);
    const parsed = enqueueJobSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const pool = getPool();
    const job = await enqueue(
      pool,
      ctx.org.id,
      parsed.data.type,
      parsed.data.payload ?? {},
      { runAfter: parsed.data.runAfter ?? null }
    );

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "job.enqueued",
      entityType: "job",
      entityId: job.id,
      metadata: { type: job.type, runAfter: job.runAfter },
    });

    return created(job);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to enqueue job.", 500);
  }
});
