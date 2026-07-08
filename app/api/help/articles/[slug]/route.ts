import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getArticleBySlug } from "@/lib/help/queries";

// GET /api/help/articles/[slug] — one org-scoped article by slug. Any member may
// read. 404 if the slug is unknown within the org.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const slug = params?.slug?.trim();
    if (!slug) {
      return fail("Invalid article slug.", 400);
    }
    const article = await getArticleBySlug(getPool(), ctx.org.id, slug);
    if (!article) {
      return fail("Article not found.", 404);
    }
    return ok(article);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load article.", 500);
  }
});
