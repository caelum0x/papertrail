import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { updateTagSchema } from "@/lib/tags/types";
import {
  getTag,
  updateTag,
  deleteTag,
  findTagByName,
  wouldCreateCycle,
} from "@/lib/tags/queries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/tags/[id] — fetch a single tag with its usage count. Any member.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid tag id.", 400);
    }
    const pool = getPool();
    const tag = await getTag(pool, ctx.org.id, id);
    if (!tag) {
      return fail("Tag not found.", 404);
    }
    return ok(tag);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load tag.", 500);
  }
});

// PATCH /api/tags/[id] — rename, recolor, or reparent a tag (editor+). Guards
// against name collisions, self-parenting, and cycles. Audited.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid tag id.", 400);
    }

    const raw = await req.json().catch(() => null);
    const parsed = updateTagSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const existing = await getTag(pool, ctx.org.id, id);
    if (!existing) {
      return fail("Tag not found.", 404);
    }

    if (parsed.data.name !== undefined) {
      const duplicate = await findTagByName(pool, ctx.org.id, parsed.data.name);
      if (duplicate && duplicate.id !== id) {
        return fail("A tag with this name already exists.", 409);
      }
    }

    const parentId = parsed.data.parentId;
    if (parentId !== undefined && parentId !== null) {
      if (parentId === id) {
        return fail("A tag cannot be its own parent.", 400);
      }
      const parent = await getTag(pool, ctx.org.id, parentId);
      if (!parent) {
        return fail("Parent tag not found.", 404);
      }
      const cycle = await wouldCreateCycle(pool, ctx.org.id, id, parentId);
      if (cycle) {
        return fail("That parent would create a cycle.", 400);
      }
    }

    const updated = await updateTag(pool, ctx.org.id, id, {
      name: parsed.data.name,
      color: parsed.data.color,
      parentId: parsed.data.parentId,
    });
    if (!updated) {
      return fail("Tag not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "tag.update",
      entityType: "tag",
      entityId: id,
      metadata: { name: updated.name },
    });

    return ok(updated);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to update tag.", 500);
  }
});

// DELETE /api/tags/[id] — remove a tag (editor+). Child tags are re-parented to
// root (ON DELETE SET NULL) and taggings cascade-deleted by the schema. Audited.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid tag id.", 400);
    }

    const pool = getPool();
    const existing = await getTag(pool, ctx.org.id, id);
    if (!existing) {
      return fail("Tag not found.", 404);
    }

    const removed = await deleteTag(pool, ctx.org.id, id);
    if (!removed) {
      return fail("Tag not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "tag.delete",
      entityType: "tag",
      entityId: id,
      metadata: { name: existing.name },
    });

    return ok({ id, deleted: true });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to delete tag.", 500);
  }
});
