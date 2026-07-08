import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getTagTree } from "@/lib/tags/queries";

// GET /api/tags/tree — the full org taxonomy as a nested tree (with usage counts).
// Not paginated: a tag vocabulary is small and the tree needs every node to build
// correctly. Any member may read.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const pool = getPool();
    const tree = await getTagTree(pool, ctx.org.id);
    return ok(tree);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load tag tree.", 500);
  }
});
