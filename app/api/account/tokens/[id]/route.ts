import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getPool } from "@/lib/db";
import { deleteToken } from "@/lib/account/repository";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function statusOf(err: unknown): number | null {
  if (err instanceof Error && "status" in err) {
    return (err as { status: number }).status;
  }
  return null;
}

// DELETE /api/account/tokens/[id] — revoke one of the current user's own tokens.
// Scoped to (org, user) so a user can never revoke someone else's token; a
// non-matching id returns 404 rather than silently succeeding.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid token id.", 400);
    }

    const removed = await deleteToken(ctx.org.id, ctx.user.id, id);
    if (!removed) {
      return fail("Token not found.", 404);
    }

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "account.token.revoke",
      entityType: "personal_token",
      entityId: id,
      metadata: {},
    });

    return ok<{ revoked: true }>({ revoked: true });
  } catch (err) {
    const s = statusOf(err);
    return fail(s ? "Forbidden." : "Couldn't revoke the token. Please try again.", s ?? 500);
  }
});
