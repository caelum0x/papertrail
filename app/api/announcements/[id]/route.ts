import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole, hasRoleAtLeast } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { updateAnnouncementSchema } from "@/lib/announcements/types";
import {
  getAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from "@/lib/announcements/queries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/announcements/[id] — fetch one announcement with the caller's read
// state. Any member may read a published one; only admins may read a draft.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid announcement id.", 400);
    }
    const pool = getPool();
    const announcement = await getAnnouncement(pool, ctx.org.id, ctx.user.id, id);
    if (!announcement) {
      return fail("Announcement not found.", 404);
    }
    // Hide drafts from non-admins (behave as if they don't exist).
    if (announcement.publishedAt === null && !hasRoleAtLeast(ctx.role, "admin")) {
      return fail("Announcement not found.", 404);
    }
    return ok(announcement);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load announcement.", 500);
  }
});

// PATCH /api/announcements/[id] — edit title/body/kind/audience (admin+). Audited.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid announcement id.", 400);
    }

    const raw = await req.json().catch(() => null);
    const parsed = updateAnnouncementSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const existing = await getAnnouncement(pool, ctx.org.id, ctx.user.id, id);
    if (!existing) {
      return fail("Announcement not found.", 404);
    }

    const updated = await updateAnnouncement(pool, ctx.org.id, id, {
      title: parsed.data.title,
      body: parsed.data.body,
      kind: parsed.data.kind,
      audience: parsed.data.audience,
    });
    if (!updated) {
      return fail("Announcement not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "announcement.update",
      entityType: "announcement",
      entityId: id,
      metadata: { title: updated.title },
    });

    return ok(updated);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to update announcement.", 500);
  }
});

// DELETE /api/announcements/[id] — remove an announcement (admin+). Reads
// cascade-delete via the schema. Audited.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid announcement id.", 400);
    }

    const pool = getPool();
    const existing = await getAnnouncement(pool, ctx.org.id, ctx.user.id, id);
    if (!existing) {
      return fail("Announcement not found.", 404);
    }

    const removed = await deleteAnnouncement(pool, ctx.org.id, id);
    if (!removed) {
      return fail("Announcement not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "announcement.delete",
      entityType: "announcement",
      entityId: id,
      metadata: { title: existing.title },
    });

    return ok({ id, deleted: true });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to delete announcement.", 500);
  }
});
