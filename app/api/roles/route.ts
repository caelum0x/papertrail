import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { createRoleSchema } from "@/lib/rbac/types";
import { listRoles, countRoles, createRole, roleNameExists } from "@/lib/rbac/queries";

// GET /api/roles — paginated, org-scoped list of custom roles. Any admin may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const { limit, offset, page } = parsePagination(req);
    const pool = getPool();
    const [roles, total] = await Promise.all([
      listRoles(pool, ctx.org.id, limit, offset),
      countRoles(pool, ctx.org.id),
    ]);
    return ok(roles, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load roles.", 500);
  }
});

// POST /api/roles — create a custom role. Admin+. Audited.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const raw = await req.json().catch(() => null);
    const parsed = createRoleSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    if (await roleNameExists(pool, ctx.org.id, parsed.data.name)) {
      return fail("A role with that name already exists.", 409);
    }

    const role = await createRole(
      pool,
      ctx.org.id,
      parsed.data.name,
      parsed.data.permissions
    );

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "role.create",
      entityType: "custom_role",
      entityId: role.id,
      metadata: { name: role.name, permissionCount: role.permissions.length },
    });

    return created(role);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create role.", 500);
  }
});
