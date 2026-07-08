import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getTag, getTagUsage } from "@/lib/tags/queries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/tags/[id]/usage — where a tag is used: total, per-entity-type
// breakdown, and a recent slice of taggings (limit via ?limit). Any member.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid tag id.", 400);
    }

    const pool = getPool();
    const tag = await getTag(pool, ctx.org.id, id);
    if (!tag) {
      return fail("Tag not found.", 404);
    }

    const { limit } = parsePagination(req);
    const usage = await getTagUsage(pool, ctx.org.id, id, limit);
    return ok(usage, { total: usage.total, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load tag usage.", 500);
  }
});
