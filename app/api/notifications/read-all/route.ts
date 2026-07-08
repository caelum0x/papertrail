import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { markAllRead } from "@/lib/notify";

export const runtime = "nodejs";

// POST /api/notifications/read-all — mark all of the current user's unread
// notifications read in the active org. Returns how many were updated. Personal
// action, so no audit entry.
export const POST = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const updated = await markAllRead(getPool(), ctx.org.id, ctx.user.id);
    return ok<{ updated: number }>({ updated });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to mark notifications read.", 500);
  }
});
