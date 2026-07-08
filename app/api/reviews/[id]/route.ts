import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { updateReviewSchema } from "@/lib/reviews/schemas";
import {
  getReview,
  updateReview,
  isOrgMember,
} from "@/lib/reviews/repository";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/reviews/[id] — single review detail. Any member may read.
export const GET = withOrg(
  async (_req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "viewer");
      const id = params?.id;
      if (!id || !UUID_RE.test(id)) {
        return fail("Invalid review id.", 400);
      }

      const review = await getReview(getPool(), ctx.org.id, id);
      if (!review) {
        return fail("Review not found.", 404);
      }
      return ok(review);
    } catch (err: unknown) {
      if (err instanceof Error && "status" in err) {
        return fail(err.message, (err as { status: number }).status);
      }
      return fail("Failed to load review.", 500);
    }
  }
);

// PATCH /api/reviews/[id] — reassign / edit metadata (not decisions). Editor+.
export const PATCH = withOrg(
  async (req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "editor");
      const id = params?.id;
      if (!id || !UUID_RE.test(id)) {
        return fail("Invalid review id.", 400);
      }

      const json = await req.json().catch(() => null);
      const parsed = updateReviewSchema.safeParse(json);
      if (!parsed.success) {
        return fail(
          parsed.error.issues[0]?.message ?? "Invalid request body.",
          400
        );
      }

      const pool = getPool();
      const existing = await getReview(pool, ctx.org.id, id);
      if (!existing) {
        return fail("Review not found.", 404);
      }

      const assigneeId = parsed.data.assigneeId;
      if (
        assigneeId !== undefined &&
        assigneeId !== null &&
        !(await isOrgMember(pool, ctx.org.id, assigneeId))
      ) {
        return fail("Assignee is not a member of this organization.", 400);
      }

      const updated = await updateReview(pool, ctx.org.id, id, {
        assigneeId: parsed.data.assigneeId,
        status: parsed.data.status,
        comment: parsed.data.comment,
        dueDate: parsed.data.dueDate,
      });
      if (!updated) {
        return fail("Review not found.", 404);
      }

      await writeAudit(pool, {
        orgId: ctx.org.id,
        userId: ctx.user.id,
        action: "review.updated",
        entityType: "review",
        entityId: id,
        metadata: {
          assigneeId: updated.assigneeId,
          status: updated.status,
        },
      });

      return ok(updated);
    } catch (err: unknown) {
      if (err instanceof Error && "status" in err) {
        return fail(err.message, (err as { status: number }).status);
      }
      return fail("Failed to update review.", 500);
    }
  }
);
