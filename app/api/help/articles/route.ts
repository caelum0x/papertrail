import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { listArticles, countArticles } from "@/lib/help/queries";

// GET /api/help/articles — paginated, org-scoped KB list. Optional ?category and
// ?search (title/body ILIKE). Any member may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);
    const url = new URL(req.url);
    const category = url.searchParams.get("category")?.trim() || undefined;
    const search = url.searchParams.get("search")?.trim() || undefined;
    const filters = { category, search };

    const pool = getPool();
    const [articles, total] = await Promise.all([
      listArticles(pool, ctx.org.id, filters, limit, offset),
      countArticles(pool, ctx.org.id, filters),
    ]);
    return ok(articles, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load help articles.", 500);
  }
});
