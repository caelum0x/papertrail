import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { updateRoleSchema } from "@/lib/rbac/types";
import { getRole, updateRole, deleteRole, roleNameExists } from "@/lib/rbac/queries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/roles/[id] — fetch a single custom role. Admin+.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid role id.", 400);
    }
    const role = await getRole(getPool(), ctx.org.id, id);
    if (!role) {
      return fail("Role not found.", 404);
    }
    return ok(role);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load role.", 500);
  }
});

// PATCH /api/roles/[id] — rename and/or replace permissions. Admin+. Audited.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid role id.", 400);
    }

    const raw = await req.json().catch(() => null);
    const parsed = updateRoleSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const existing = await getRole(pool, ctx.org.id, id);
    if (!existing) {
      return fail("Role not found.", 404);
    }
    if (
      parsed.data.name !== undefined &&
      (await roleNameExists(pool, ctx.org.id, parsed.data.name, id))
    ) {
      return fail("A role with that name already exists.", 409);
    }

    const updated = await updateRole(pool, ctx.org.id, id, {
      name: parsed.data.name,
      permissions: parsed.data.permissions,
    });
    if (!updated) {
      return fail("Role not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "role.update",
      entityType: "custom_role",
      entityId: id,
      metadata: { name: updated.name, permissionCount: updated.permissions.length },
    });

    return ok(updated);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to update role.", 500);
  }
});

// DELETE /api/roles/[id] — remove a custom role. Admin+. Audited.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid role id.", 400);
    }

    const pool = getPool();
    const existing = await getRole(pool, ctx.org.id, id);
    if (!existing) {
      return fail("Role not found.", 404);
    }
    const removed = await deleteRole(pool, ctx.org.id, id);
    if (!removed) {
      return fail("Role not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "role.delete",
      entityType: "custom_role",
      entityId: id,
      metadata: { name: existing.name },
    });

    return ok({ id });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to delete role.", 500);
  }
});
