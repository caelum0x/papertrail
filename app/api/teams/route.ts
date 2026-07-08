import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { createTeamSchema } from "@/lib/rbac/types";
import { listTeams, countTeams, createTeam, teamNameExists } from "@/lib/rbac/queries";

// GET /api/teams — paginated, org-scoped list of teams with member counts.
// Any member may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);
    const pool = getPool();
    const [teams, total] = await Promise.all([
      listTeams(pool, ctx.org.id, limit, offset),
      countTeams(pool, ctx.org.id),
    ]);
    return ok(teams, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load teams.", 500);
  }
});

// POST /api/teams — create a team. Admin+. Audited.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const raw = await req.json().catch(() => null);
    const parsed = createTeamSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    if (await teamNameExists(pool, ctx.org.id, parsed.data.name)) {
      return fail("A team with that name already exists.", 409);
    }

    const team = await createTeam(
      pool,
      ctx.org.id,
      parsed.data.name,
      parsed.data.description ?? null
    );

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "team.create",
      entityType: "team",
      entityId: team.id,
      metadata: { name: team.name },
    });

    return created(team);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create team.", 500);
  }
});
