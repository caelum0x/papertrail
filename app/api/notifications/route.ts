import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import {
  countNotifications,
  listNotifications,
  type Notification,
} from "@/lib/notify";

export const runtime = "nodejs";

// GET /api/notifications — the current user's own notifications in the active
// org, newest first. ?unread=true limits to unread. Any authenticated member
// (viewer+) may read their own feed. `meta.total` reflects the unread count when
// filtering unread, else the full count, so clients can size a badge from it.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const pool = getPool();
    const { limit, offset, page } = parsePagination(req);
    const unreadOnly =
      new URL(req.url).searchParams.get("unread") === "true";

    const [total, notifications] = await Promise.all([
      countNotifications(pool, ctx.org.id, ctx.user.id, unreadOnly),
      listNotifications(
        pool,
        ctx.org.id,
        ctx.user.id,
        unreadOnly,
        limit,
        offset
      ),
    ]);

    return ok<Notification[]>(notifications, { total, page, limit });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load notifications.", 500);
  }
});
