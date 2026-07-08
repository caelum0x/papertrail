import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import {
  listCommentsQuerySchema,
  createCommentSchema,
  listComments,
  createComment,
  commentExists,
  recordActivity,
  extractMentions,
  type Comment,
} from "./shared";

export const runtime = "nodejs";

// GET /api/comments?entity_type&entity_id — the comment thread for one entity,
// oldest-first. Any member (viewer+) may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");

    const url = new URL(req.url);
    const parsed = listCommentsQuerySchema.safeParse({
      entity_type: url.searchParams.get("entity_type") ?? undefined,
      entity_id: url.searchParams.get("entity_id") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid query.", 400);
    }

    const comments = await listComments(
      getPool(),
      ctx.org.id,
      parsed.data.entity_type,
      parsed.data.entity_id
    );
    return ok<Comment[]>(comments);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load comments.", 500);
  }
});

// POST /api/comments — add a comment (or reply via parentId). Editor+.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const json = await req.json().catch(() => null);
    const parsed = createCommentSchema.safeParse(json);
    if (!parsed.success) {
      return fail(
        parsed.error.issues[0]?.message ?? "Invalid request body.",
        400
      );
    }

    const pool = getPool();
    const parentId = parsed.data.parentId ?? null;
    if (parentId && !(await commentExists(pool, ctx.org.id, parentId))) {
      return fail("Parent comment not found in this organization.", 400);
    }

    const comment = await createComment(pool, {
      orgId: ctx.org.id,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      parentId,
      authorId: ctx.user.id,
      body: parsed.data.body,
    });

    const mentions = extractMentions(comment.body);

    await recordActivity(pool, {
      orgId: ctx.org.id,
      actorId: ctx.user.id,
      verb: parentId ? "replied" : "commented",
      entityType: comment.entityType,
      entityId: comment.entityId,
      metadata: { commentId: comment.id, mentions },
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "comment.created",
      entityType: "comment",
      entityId: comment.id,
      metadata: {
        entityType: comment.entityType,
        entityId: comment.entityId,
        parentId,
        mentions,
      },
    });

    return created(comment);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create comment.", 500);
  }
});
