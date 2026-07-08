import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { listCategories } from "@/lib/help/queries";

// GET /api/help/categories — distinct KB categories with article counts, for the
// console's CategoryList. Any member may read.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const categories = await listCategories(getPool(), ctx.org.id);
    return ok(categories);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load categories.", 500);
  }
});
