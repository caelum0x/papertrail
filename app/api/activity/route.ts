import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import {
  activityQuerySchema,
  listActivity,
  type ActivityItem,
} from "../comments/shared";

export const runtime = "nodejs";

// GET /api/activity — the org activity feed, newest-first, paginated. Optional
// filters: entity_type, entity_id, actor_id, verb. Any member (viewer+) may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");

    const url = new URL(req.url);
    const parsed = activityQuerySchema.safeParse({
      entity_type: url.searchParams.get("entity_type") ?? undefined,
      entity_id: url.searchParams.get("entity_id") ?? undefined,
      actor_id: url.searchParams.get("actor_id") ?? undefined,
      verb: url.searchParams.get("verb") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid query.", 400);
    }

    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listActivity(
      getPool(),
      ctx.org.id,
      {
        entityType: parsed.data.entity_type,
        entityId: parsed.data.entity_id,
        actorId: parsed.data.actor_id,
        verb: parsed.data.verb,
      },
      limit,
      offset
    );

    return ok<ActivityItem[]>(items, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load activity.", 500);
  }
});
