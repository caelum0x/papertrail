import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getDirectory, deleteDirectory } from "@/lib/sso/repository";
import type { ScimDirectory } from "@/lib/sso/types";

export const runtime = "nodejs";

// GET /api/scim-directories/[id] — one directory's metadata (no token). Admin+.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id) return fail("Directory id is required.", 400);

    const pool = getPool();
    const directory = await getDirectory(pool, ctx.org.id, id);
    if (!directory) return fail("SCIM directory not found.", 404);

    return ok<ScimDirectory>(directory);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load SCIM directory.", 500);
  }
});

// DELETE /api/scim-directories/[id] — revoke a SCIM directory (its bearer token
// stops working immediately). Admin+ only.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id) return fail("Directory id is required.", 400);

    const pool = getPool();
    const deleted = await deleteDirectory(pool, ctx.org.id, id);
    if (!deleted) return fail("SCIM directory not found.", 404);

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "scim_directory.delete",
      entityType: "scim_directory",
      entityId: id,
      metadata: { name: deleted.name },
    });

    return ok<ScimDirectory>(deleted);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to delete SCIM directory.", 500);
  }
});
