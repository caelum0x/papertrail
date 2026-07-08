import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { updateViewSchema } from "@/lib/views/types";
import {
  getView,
  updateView,
  deleteView,
  findViewByName,
} from "@/lib/views/queries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/views/[id] — fetch a single view the caller may see (own or shared).
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid view id.", 400);
    }
    const pool = getPool();
    const view = await getView(pool, ctx.org.id, ctx.user.id, id);
    if (!view) {
      return fail("View not found.", 404);
    }
    return ok(view);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load view.", 500);
  }
});

// PATCH /api/views/[id] — rename, retune the query, or toggle sharing (editor+).
// Owner-only mutation: a shared view can be read by others but only its owner can
// change it. Guards against per-owner name collisions. Audited.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid view id.", 400);
    }

    const raw = await req.json().catch(() => null);
    const parsed = updateViewSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const existing = await getView(pool, ctx.org.id, ctx.user.id, id);
    if (!existing) {
      return fail("View not found.", 404);
    }
    if (!existing.isOwner) {
      return fail("Only the owner can modify this view.", 403);
    }

    if (parsed.data.name !== undefined) {
      const duplicate = await findViewByName(
        pool,
        ctx.org.id,
        ctx.user.id,
        existing.resource,
        parsed.data.name
      );
      if (duplicate && duplicate.id !== id) {
        return fail("You already have a view with this name.", 409);
      }
    }

    const updated = await updateView(pool, ctx.org.id, ctx.user.id, id, {
      name: parsed.data.name,
      query: parsed.data.query,
      shared: parsed.data.shared,
    });
    if (!updated) {
      return fail("View not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "view.update",
      entityType: "saved_view",
      entityId: id,
      metadata: { name: updated.name, shared: updated.shared },
    });

    return ok(updated);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to update view.", 500);
  }
});

// DELETE /api/views/[id] — remove a view (editor+). Owner-only. Audited.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid view id.", 400);
    }

    const pool = getPool();
    const existing = await getView(pool, ctx.org.id, ctx.user.id, id);
    if (!existing) {
      return fail("View not found.", 404);
    }
    if (!existing.isOwner) {
      return fail("Only the owner can delete this view.", 403);
    }

    const removed = await deleteView(pool, ctx.org.id, ctx.user.id, id);
    if (!removed) {
      return fail("View not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "view.delete",
      entityType: "saved_view",
      entityId: id,
      metadata: { name: existing.name, resource: existing.resource },
    });

    return ok({ id, deleted: true });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to delete view.", 500);
  }
});
