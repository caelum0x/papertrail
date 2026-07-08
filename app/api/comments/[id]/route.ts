import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole, hasRoleAtLeast } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import {
  UUID_RE,
  updateCommentSchema,
  getComment,
  updateComment,
  deleteComment,
} from "../shared";

export const runtime = "nodejs";

// PATCH /api/comments/[id] — edit a comment body. Editor+, but only the author
// may edit their own comment (admins may not silently rewrite others' words).
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid comment id.", 400);
    }

    const json = await req.json().catch(() => null);
    const parsed = updateCommentSchema.safeParse(json);
    if (!parsed.success) {
      return fail(
        parsed.error.issues[0]?.message ?? "Invalid request body.",
        400
      );
    }

    const pool = getPool();
    const existing = await getComment(pool, ctx.org.id, id);
    if (!existing) {
      return fail("Comment not found.", 404);
    }
    if (existing.authorId !== ctx.user.id) {
      return fail("You can only edit your own comments.", 403);
    }

    const updated = await updateComment(pool, ctx.org.id, id, parsed.data.body);
    if (!updated) {
      return fail("Comment not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "comment.updated",
      entityType: "comment",
      entityId: id,
      metadata: { entityType: updated.entityType, entityId: updated.entityId },
    });

    return ok(updated);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to update comment.", 500);
  }
});

// DELETE /api/comments/[id] — remove a comment (and its replies, via cascade).
// The author may delete their own; admins+ may moderate any comment.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid comment id.", 400);
    }

    const pool = getPool();
    const existing = await getComment(pool, ctx.org.id, id);
    if (!existing) {
      return fail("Comment not found.", 404);
    }

    const isAuthor = existing.authorId === ctx.user.id;
    const canModerate = hasRoleAtLeast(ctx.role, "admin");
    if (!isAuthor && !canModerate) {
      return fail("You can only delete your own comments.", 403);
    }

    const removed = await deleteComment(pool, ctx.org.id, id);
    if (!removed) {
      return fail("Comment not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "comment.deleted",
      entityType: "comment",
      entityId: id,
      metadata: {
        entityType: existing.entityType,
        entityId: existing.entityId,
        moderated: !isAuthor,
      },
    });

    return ok({ id, deleted: true });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to delete comment.", 500);
  }
});
