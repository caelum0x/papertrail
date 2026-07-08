import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import {
  countMembers,
  listMembers,
  generateInviteToken,
} from "@/lib/org-team/repository";
import { createMemberSchema } from "@/lib/org-team/schemas";
import type { Member, Invitation } from "@/lib/org-team/types";

export const runtime = "nodejs";

// GET /api/members — paginated list of members in the current org.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const pool = getPool();
    const { limit, offset, page } = parsePagination(req);
    const [total, members] = await Promise.all([
      countMembers(pool, ctx.org.id),
      listMembers(pool, ctx.org.id, limit, offset),
    ]);
    return ok<Member[]>(members, { total, page, limit });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load members.", 500);
  }
});

// POST /api/members — add an existing user directly if they already have an
// account, otherwise create a pending invitation. Admin+ only.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const json = await req.json().catch(() => null);
    const parsed = createMemberSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }
    const { email, role } = parsed.data;
    const pool = getPool();

    const userRes = await pool.query(
      `select id, email, name from users where email = $1`,
      [email]
    );

    if (userRes.rows.length > 0) {
      const targetUser = userRes.rows[0];
      const existing = await pool.query(
        `select 1 from memberships where org_id = $1 and user_id = $2`,
        [ctx.org.id, targetUser.id]
      );
      if (existing.rows.length > 0) {
        return fail("This user is already a member of the organization.", 409);
      }
      const inserted = await pool.query(
        `insert into memberships (org_id, user_id, role)
           values ($1, $2, $3)
         returning id, created_at`,
        [ctx.org.id, targetUser.id, role]
      );
      const member: Member = {
        id: inserted.rows[0].id,
        userId: targetUser.id,
        email: targetUser.email,
        name: targetUser.name ?? null,
        role,
        joinedAt: new Date(inserted.rows[0].created_at).toISOString(),
      };
      await writeAudit(pool, {
        orgId: ctx.org.id,
        userId: ctx.user.id,
        action: "member.add",
        entityType: "membership",
        entityId: member.id,
        metadata: { email, role },
      });
      return created<Member>(member);
    }

    // No account yet — create a pending invitation instead.
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
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to add member.", 500);
  }
});
