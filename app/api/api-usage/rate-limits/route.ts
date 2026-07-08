import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { rateLimitQuerySchema } from "@/lib/apiusage/schemas";
import { listRateLimitEvents } from "@/lib/apiusage/queries";

export const runtime = "nodejs";

// GET /api/api-usage/rate-limits — paginated, org-scoped log of throttled requests
// with optional route / apiKeyId filters. Newest first. Admin+.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");

    const url = new URL(req.url);
    const parsed = rateLimitQuerySchema.safeParse({
      route: url.searchParams.get("route") ?? undefined,
      apiKeyId: url.searchParams.get("apiKeyId") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid query.", 400);
    }

    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listRateLimitEvents({
      orgId: ctx.org.id,
      ...parsed.data,
      limit,
      offset,
    });

    return ok(items, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't load rate-limit events. Please try again.", 500);
  }
});
