import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getPool } from "@/lib/db";
import { deleteSession } from "@/lib/account/repository";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function statusOf(err: unknown): number | null {
  if (err instanceof Error && "status" in err) {
    return (err as { status: number }).status;
  }
  return null;
}

// DELETE /api/account/sessions/[id] — revoke (sign out) one of the current user's
// own sessions. Scoped to (org, user); a non-matching id returns 404.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid session id.", 400);
    }

    const removed = await deleteSession(ctx.org.id, ctx.user.id, id);
    if (!removed) {
      return fail("Session not found.", 404);
    }

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "account.session.revoke",
      entityType: "user_session",
      entityId: id,
      metadata: {},
    });

    return ok<{ revoked: true }>({ revoked: true });
  } catch (err) {
    const s = statusOf(err);
    return fail(s ? "Forbidden." : "Couldn't revoke the session. Please try again.", s ?? 500);
  }
});
