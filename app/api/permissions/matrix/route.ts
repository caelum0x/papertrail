import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { ACTIONS, RESOURCE_CATALOG } from "@/lib/rbac/catalog";
import { listRoles } from "@/lib/rbac/queries";

// GET /api/permissions/matrix — the permission catalog plus every custom role's
// permission set, shaped so the UI can render a resource×role coverage matrix.
// Admin+.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const roles = await listRoles(getPool(), ctx.org.id, 100, 0);
    return ok({
      actions: ACTIONS,
      resources: RESOURCE_CATALOG,
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        permissions: r.permissions,
      })),
    });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load permission matrix.", 500);
  }
});
