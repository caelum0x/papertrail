import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import {
  countInvitations,
  listInvitations,
  generateInviteToken,
} from "@/lib/org-team/repository";
import { inviteMemberSchema } from "@/lib/org-team/schemas";
import type { Invitation } from "@/lib/org-team/types";

export const runtime = "nodejs";

function statusOf(err: unknown): number | null {
  if (err instanceof Error && "status" in err) {
    return (err as { status: number }).status;
  }
  return null;
}

// GET /api/invitations — paginated invitations (pending + accepted) for the org.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const pool = getPool();
    const { limit, offset, page } = parsePagination(req);
    const [total, invitations] = await Promise.all([
      countInvitations(pool, ctx.org.id),
      listInvitations(pool, ctx.org.id, limit, offset),
    ]);
    return ok<Invitation[]>(invitations, { total, page, limit });
  } catch (err) {
    const s = statusOf(err);
    return fail(s ? "Forbidden." : "Failed to load invitations.", s ?? 500);
  }
});

// POST /api/invitations — invite an email to the org. Admin+ only.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const json = await req.json().catch(() => null);
    const parsed = inviteMemberSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }
    const { email, role } = parsed.data;
    const pool = getPool();

    // Already a member?
    const memberRes = await pool.query(
      `select 1
         from memberships m
         join users u on u.id = m.user_id
        where m.org_id = $1 and u.email = $2 limit 1`,
      [ctx.org.id, email]
    );
    if (memberRes.rows.length > 0) {
      return fail("This user is already a member of the organization.", 409);
    }

    // Already invited and still pending?
    const openInvite = await pool.query(
      `select 1 from invitations
        where org_id = $1 and email = $2 and accepted_at is null limit 1`,
      [ctx.org.id, email]
    );
    if (openInvite.rows.length > 0) {
      return fail("An invitation is already pending for this email.", 409);
    }

    const token = generateInviteToken();
    const invRes = await pool.query(
      `insert into invitations (org_id, email, role, token, invited_by)
         values ($1, $2, $3, $4, $5)
       returning id, created_at`,
      [ctx.org.id, email, role, token, ctx.user.id]
    );
    const invitation: Invitation = {
      id: invRes.rows[0].id,
      email,
      role,
      token,
      invitedBy: ctx.user.id,
      inviterName: ctx.user.name,
      acceptedAt: null,
      createdAt: new Date(invRes.rows[0].created_at).toISOString(),
      pending: true,
    };
    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "invitation.create",
      entityType: "invitation",
      entityId: invitation.id,
      metadata: { email, role },
    });
    return created<Invitation>(invitation);
  } catch (err) {
    const s = statusOf(err);
    return fail(s ? "Forbidden." : "Failed to create invitation.", s ?? 500);
  }
});
