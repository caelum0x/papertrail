import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { markRead, type Notification } from "@/lib/notify";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/notifications/[id]/read — mark one of the current user's own
// notifications read. Org- and user-scoped: a member can only mark their own.
// This is a personal, low-stakes action, so no audit entry is written.
export const POST = withOrg(
  async (_req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "viewer");
      const id = params?.id;
      if (!id || !UUID_RE.test(id)) {
        return fail("Invalid notification id.", 400);
      }

      const updated = await markRead(
        getPool(),
        ctx.org.id,
        ctx.user.id,
        id
      );
      if (!updated) {
        return fail("Notification not found.", 404);
      }
      return ok<Notification>(updated);
    } catch (err) {
      if (err instanceof Error && "status" in err) {
        return fail(err.message, (err as { status: number }).status);
      }
      return fail("Failed to mark notification read.", 500);
    }
  }
);
