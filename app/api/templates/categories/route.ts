import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { listCategories, type CategoryStat } from "../repository";

export const runtime = "nodejs";

// GET /api/templates/categories — distinct categories in use across the org's
// templates, each with a count. Powers the category filter and manager. Any
// member may read.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const categories = await listCategories(ctx.org.id);
    return ok<CategoryStat[]>(categories);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't load categories. Please try again.", 500);
  }
});
