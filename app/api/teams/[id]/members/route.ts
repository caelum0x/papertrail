import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { addMemberSchema } from "@/lib/rbac/types";
import {
  getTeam,
  listTeamMembers,
  addTeamMember,
  removeTeamMember,
  listAssignableMembers,
} from "@/lib/rbac/queries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/teams/[id]/members — list members plus org members still assignable.
// Any member may read.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const teamId = params?.id;
    if (!teamId || !UUID_RE.test(teamId)) {
      return fail("Invalid team id.", 400);
    }

    const pool = getPool();
    const team = await getTeam(pool, ctx.org.id, teamId);
    if (!team) {
      return fail("Team not found.", 404);
    }

    const [members, assignable] = await Promise.all([
      listTeamMembers(pool, ctx.org.id, teamId),
      listAssignableMembers(pool, ctx.org.id, teamId),
    ]);
    return ok({ members, assignable });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load team members.", 500);
  }
});

// POST /api/teams/[id]/members — add an org member to the team. Admin+. Audited.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const teamId = params?.id;
    if (!teamId || !UUID_RE.test(teamId)) {
      return fail("Invalid team id.", 400);
    }

    const raw = await req.json().catch(() => null);
    const parsed = addMemberSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const team = await getTeam(pool, ctx.org.id, teamId);
    if (!team) {
      return fail("Team not found.", 404);
    }

    const member = await addTeamMember(pool, ctx.org.id, teamId, parsed.data.userId);
    if (!member) {
      return fail("That user is not a member of this organization.", 400);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "team.member.add",
      entityType: "team",
      entityId: teamId,
      metadata: { userId: member.userId },
    });

    return created(member);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to add team member.", 500);
  }
});

// DELETE /api/teams/[id]/members?userId= — remove a member. Admin+. Audited.
export const DELETE = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const teamId = params?.id;
    if (!teamId || !UUID_RE.test(teamId)) {
      return fail("Invalid team id.", 400);
    }
    const url = new URL(req.url);
    const userId = url.searchParams.get("userId");
    if (!userId || !UUID_RE.test(userId)) {
      return fail("A valid userId query param is required.", 400);
    }

    const pool = getPool();
    const team = await getTeam(pool, ctx.org.id, teamId);
    if (!team) {
      return fail("Team not found.", 404);
    }

    const removed = await removeTeamMember(pool, ctx.org.id, teamId, userId);
    if (!removed) {
      return fail("Member not found on this team.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "team.member.remove",
      entityType: "team",
      entityId: teamId,
      metadata: { userId },
    });

    return ok({ teamId, userId });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to remove team member.", 500);
  }
});
