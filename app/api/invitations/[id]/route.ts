import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getInvitation } from "@/lib/org-team/repository";

export const runtime = "nodejs";

function statusOf(err: unknown): number | null {
  if (err instanceof Error && "status" in err) {
    return (err as { status: number }).status;
  }
  return null;
}

// DELETE /api/invitations/[id] — revoke a pending invitation. Admin+ only.
export const DELETE = withOrg(
  async (_req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "admin");
      const id = params?.id;
      if (!id) return fail("Invitation id is required.", 400);

      const pool = getPool();
      const invitation = await getInvitation(pool, ctx.org.id, id);
      if (!invitation) return fail("Invitation not found.", 404);
      if (!invitation.pending) {
        return fail("This invitation has already been accepted.", 409);
      }

      await pool.query(
        `delete from invitations where org_id = $1 and id = $2`,
        [ctx.org.id, id]
      );
      await writeAudit(pool, {
        orgId: ctx.org.id,
        userId: ctx.user.id,
        action: "invitation.revoke",
        entityType: "invitation",
        entityId: id,
        metadata: { email: invitation.email },
      });
      return ok<{ id: string; revoked: true }>({ id, revoked: true });
    } catch (err) {
      const s = statusOf(err);
      return fail(s ? "Forbidden." : "Failed to revoke invitation.", s ?? 500);
    }
  }
);
