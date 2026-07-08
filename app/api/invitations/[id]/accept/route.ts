import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withAuth, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { writeAudit } from "@/lib/audit";
import type { Role } from "@/lib/authz/rbac";

export const runtime = "nodejs";

interface AcceptResult {
  orgId: string;
  membershipId: string;
  role: Role;
}

// POST /api/invitations/[id]/accept — the invited user (matched by session
// email) accepts, creating their membership. Auth-only: the acceptor is not yet
// a member of the target org, so withOrg can't be used here.
export const POST = withAuth(
  async (_req: NextRequest, user: Ctx["user"], params) => {
    try {
      const id = params?.id;
      if (!id) return fail("Invitation id is required.", 400);

      const pool = getPool();
      const invRes = await pool.query(
        `select id, org_id, email, role, accepted_at
           from invitations where id = $1`,
        [id]
      );
      if (invRes.rows.length === 0) {
        return fail("Invitation not found.", 404);
      }
      const inv = invRes.rows[0];

      if (inv.accepted_at) {
        return fail("This invitation has already been accepted.", 409);
      }
      if (String(inv.email).toLowerCase() !== user.email.toLowerCase()) {
        return fail("This invitation is for a different email address.", 403);
      }

      const client = await pool.connect();
      try {
        await client.query("begin");

        const existing = await client.query(
          `select id from memberships where org_id = $1 and user_id = $2`,
          [inv.org_id, user.id]
        );

        let membershipId: string;
        if (existing.rows.length > 0) {
          membershipId = existing.rows[0].id;
        } else {
          const insertRes = await client.query(
            `insert into memberships (org_id, user_id, role)
               values ($1, $2, $3)
             returning id`,
            [inv.org_id, user.id, inv.role]
          );
          membershipId = insertRes.rows[0].id;
        }

        await client.query(
          `update invitations set accepted_at = now()
            where id = $1 and accepted_at is null`,
          [id]
        );

        await client.query("commit");

        const result: AcceptResult = {
          orgId: inv.org_id,
          membershipId,
          role: inv.role as Role,
        };
        await writeAudit(pool, {
          orgId: inv.org_id,
          userId: user.id,
          action: "invitation.accept",
          entityType: "invitation",
          entityId: id,
          metadata: { email: user.email, role: inv.role },
        });
        return ok<AcceptResult>(result);
      } catch (txErr) {
        await client.query("rollback").catch(() => undefined);
        throw txErr;
      } finally {
        client.release();
      }
    } catch {
      return fail("Failed to accept invitation.", 500);
    }
  }
);
