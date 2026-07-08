import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import {
  getAnnouncement,
  publishAnnouncement,
} from "@/lib/announcements/queries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/announcements/[id]/publish — stamp published_at so the announcement
// becomes member-visible (admin+). Idempotent. Audited.
export const POST = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
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

    const published = await publishAnnouncement(pool, ctx.org.id, id);
    if (!published) {
      return fail("Announcement not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "announcement.publish",
      entityType: "announcement",
      entityId: id,
      metadata: { title: published.title, publishedAt: published.publishedAt },
    });

    return ok(published);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to publish announcement.", 500);
  }
});
