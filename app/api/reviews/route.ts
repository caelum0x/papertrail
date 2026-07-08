import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import {
  createReviewSchema,
  queueQuerySchema,
} from "@/lib/reviews/schemas";
import {
  listReviews,
  createReview,
  isOrgMember,
} from "@/lib/reviews/repository";

// GET /api/reviews — the review queue. scope=mine|all, optional status filter,
// paginated. Any member (viewer+) may read the queue.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");

    const url = new URL(req.url);
    const parsed = queueQuerySchema.safeParse({
      scope: url.searchParams.get("scope") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid query.", 400);
    }

    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listReviews(getPool(), {
      orgId: ctx.org.id,
      scope: parsed.data.scope,
      currentUserId: ctx.user.id,
      status: parsed.data.status,
      limit,
      offset,
    });

    return ok(items, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load reviews.", 500);
  }
});

// POST /api/reviews — create/assign a review. Editors and above may submit.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const json = await req.json().catch(() => null);
    const parsed = createReviewSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const pool = getPool();
    const assigneeId = parsed.data.assigneeId ?? null;
    if (assigneeId && !(await isOrgMember(pool, ctx.org.id, assigneeId))) {
      return fail("Assignee is not a member of this organization.", 400);
    }

    const review = await createReview(pool, {
      orgId: ctx.org.id,
      projectId: parsed.data.projectId ?? null,
      claimId: parsed.data.claimId ?? null,
      assigneeId,
      comment: parsed.data.comment ?? null,
      dueDate: parsed.data.dueDate ?? null,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "review.created",
      entityType: "review",
      entityId: review.id,
      metadata: {
        claimId: review.claimId,
        projectId: review.projectId,
        assigneeId: review.assigneeId,
      },
    });

    return created(review);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create review.", 500);
  }
});
