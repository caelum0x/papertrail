import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole, hasRoleAtLeast } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import {
  getAnnouncement,
  markAnnouncementRead,
} from "@/lib/announcements/queries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/announcements/[id]/read — record that the caller has read this
// announcement (any member). Idempotent. Only published announcements can be
// marked read (a draft isn't visible to the member yet). Audited.
export const POST = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid announcement id.", 400);
    }

    const pool = getPool();
    const existing = await getAnnouncement(pool, ctx.org.id, ctx.user.id, id);
    if (!existing) {
      return fail("Announcement not found.", 404);
    }
    // A member can only mark a published announcement read. Admins previewing a
    // draft would create a read row for an item no one else can see, so block it.
    if (existing.publishedAt === null) {
      if (!hasRoleAtLeast(ctx.role, "admin")) {
        return fail("Announcement not found.", 404);
      }
      return fail("Cannot mark an unpublished announcement as read.", 409);
    }

    const read = await markAnnouncementRead(pool, ctx.org.id, ctx.user.id, id);

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "announcement.read",
      entityType: "announcement",
      entityId: id,
      metadata: {},
    });

    return ok(read);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to mark announcement read.", 500);
  }
});
