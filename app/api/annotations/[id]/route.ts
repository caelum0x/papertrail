import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole, hasRoleAtLeast } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { UUID_RE, getAnnotation, deleteAnnotation } from "../../comments/shared";

export const runtime = "nodejs";

// DELETE /api/annotations/[id] — remove an annotation. The author may delete
// their own; admins+ may moderate any annotation.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid annotation id.", 400);
    }

    const pool = getPool();
    const existing = await getAnnotation(pool, ctx.org.id, id);
    if (!existing) {
      return fail("Annotation not found.", 404);
    }

    const isAuthor = existing.authorId === ctx.user.id;
    const canModerate = hasRoleAtLeast(ctx.role, "admin");
    if (!isAuthor && !canModerate) {
      return fail("You can only delete your own annotations.", 403);
    }

    const removed = await deleteAnnotation(pool, ctx.org.id, id);
    if (!removed) {
      return fail("Annotation not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "annotation.deleted",
      entityType: "annotation",
      entityId: id,
      metadata: {
        documentId: existing.documentId,
        pageNumber: existing.pageNumber,
        moderated: !isAuthor,
      },
    });

    return ok({ id, deleted: true });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to delete annotation.", 500);
  }
});
