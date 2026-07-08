import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { updateTeamSchema } from "@/lib/rbac/types";
import { getTeam, updateTeam, deleteTeam, teamNameExists } from "@/lib/rbac/queries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/teams/[id] — fetch a single team with its member count. Any member.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid team id.", 400);
    }
    const team = await getTeam(getPool(), ctx.org.id, id);
    if (!team) {
      return fail("Team not found.", 404);
    }
    return ok(team);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load team.", 500);
  }
});

// PATCH /api/teams/[id] — rename and/or edit description. Admin+. Audited.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid team id.", 400);
    }

    const raw = await req.json().catch(() => null);
    const parsed = updateTeamSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const existing = await getTeam(pool, ctx.org.id, id);
    if (!existing) {
      return fail("Team not found.", 404);
    }
    if (
      parsed.data.name !== undefined &&
      (await teamNameExists(pool, ctx.org.id, parsed.data.name, id))
    ) {
      return fail("A team with that name already exists.", 409);
    }

    const updated = await updateTeam(pool, ctx.org.id, id, {
      name: parsed.data.name,
      description: parsed.data.description,
    });
    if (!updated) {
      return fail("Team not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "team.update",
      entityType: "team",
      entityId: id,
      metadata: { name: updated.name },
    });

    return ok(updated);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to update team.", 500);
  }
});

// DELETE /api/teams/[id] — remove a team (cascades members). Admin+. Audited.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid team id.", 400);
    }

    const pool = getPool();
    const existing = await getTeam(pool, ctx.org.id, id);
    if (!existing) {
      return fail("Team not found.", 404);
    }
    const removed = await deleteTeam(pool, ctx.org.id, id);
    if (!removed) {
      return fail("Team not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "team.delete",
      entityType: "team",
      entityId: id,
      metadata: { name: existing.name },
    });

    return ok({ id });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to delete team.", 500);
  }
});
