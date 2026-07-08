import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getMember, countOwners } from "@/lib/org-team/repository";
import { updateMemberSchema } from "@/lib/org-team/schemas";
import type { Member } from "@/lib/org-team/types";

export const runtime = "nodejs";

function statusOf(err: unknown): number | null {
  if (err instanceof Error && "status" in err) {
    return (err as { status: number }).status;
  }
  return null;
}

// GET /api/members/[id] — member detail. Viewer+ may read.
export const GET = withOrg(
  async (_req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "viewer");
      const id = params?.id;
      if (!id) return fail("Member id is required.", 400);
      const member = await getMember(getPool(), ctx.org.id, id);
      if (!member) return fail("Member not found.", 404);
      return ok<Member>(member);
    } catch (err) {
      const s = statusOf(err);
      return fail(s ? "Forbidden." : "Failed to load member.", s ?? 500);
    }
  }
);

// PATCH /api/members/[id] — change a member's role. Admin+ only. Cannot demote
// the last owner of the org.
export const PATCH = withOrg(
  async (req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "admin");
      const id = params?.id;
      if (!id) return fail("Member id is required.", 400);

      const json = await req.json().catch(() => null);
      const parsed = updateMemberSchema.safeParse(json);
      if (!parsed.success) {
        return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
      }
      const { role } = parsed.data;

      const pool = getPool();
      const member = await getMember(pool, ctx.org.id, id);
      if (!member) return fail("Member not found.", 404);

      // Only an owner may grant or revoke the owner role.
      if (
        (role === "owner" || member.role === "owner") &&
        ctx.role !== "owner"
      ) {
        return fail("Only an owner can change the owner role.", 403);
      }

      if (member.role === "owner" && role !== "owner") {
        const owners = await countOwners(pool, ctx.org.id);
        if (owners <= 1) {
          return fail("The organization must have at least one owner.", 409);
        }
      }

      if (member.role === role) {
        return ok<Member>(member);
      }

      const updated = await pool.query(
        `update memberships set role = $3, updated_at = now()
          where org_id = $1 and id = $2
        returning id`,
        [ctx.org.id, id, role]
      );
      if (updated.rows.length === 0) {
        return fail("Member not found.", 404);
      }
      const next: Member = { ...member, role };
      await writeAudit(pool, {
        orgId: ctx.org.id,
        userId: ctx.user.id,
        action: "member.update_role",
        entityType: "membership",
        entityId: id,
        metadata: { from: member.role, to: role, userId: member.userId },
      });
      return ok<Member>(next);
    } catch (err) {
      const s = statusOf(err);
      return fail(s ? "Forbidden." : "Failed to update member.", s ?? 500);
    }
  }
);

// DELETE /api/members/[id] — remove a member. Admin+ only. Cannot remove the
// last owner.
export const DELETE = withOrg(
  async (_req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "admin");
      const id = params?.id;
      if (!id) return fail("Member id is required.", 400);

      const pool = getPool();
      const member = await getMember(pool, ctx.org.id, id);
      if (!member) return fail("Member not found.", 404);

      if (member.role === "owner" && ctx.role !== "owner") {
        return fail("Only an owner can remove an owner.", 403);
      }
      if (member.role === "owner") {
        const owners = await countOwners(pool, ctx.org.id);
        if (owners <= 1) {
          return fail("The organization must have at least one owner.", 409);
        }
      }

      await pool.query(
        `delete from memberships where org_id = $1 and id = $2`,
        [ctx.org.id, id]
      );
      await writeAudit(pool, {
        orgId: ctx.org.id,
        userId: ctx.user.id,
        action: "member.remove",
        entityType: "membership",
        entityId: id,
        metadata: { email: member.email, userId: member.userId },
      });
      return ok<{ id: string; removed: true }>({ id, removed: true });
    } catch (err) {
      const s = statusOf(err);
      return fail(s ? "Forbidden." : "Failed to remove member.", s ?? 500);
    }
  }
);
