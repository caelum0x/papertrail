import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getIntegration, countEvents, listEvents } from "@/lib/integrations/repository";
import type { IntegrationEvent } from "@/lib/integrations/types";

export const runtime = "nodejs";

// GET /api/integrations/[id]/events — paginated newest-first log of a
// connector's inbound/outbound events. Admin+ only, org-scoped.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id) return fail("Integration id is required.", 400);

    const pool = getPool();
    // Confirm the connector exists in this org before listing its events.
    const integration = await getIntegration(pool, ctx.org.id, id);
    if (!integration) return fail("Integration not found.", 404);

    const { limit, offset, page } = parsePagination(req);
    const [total, events] = await Promise.all([
      countEvents(pool, ctx.org.id, id),
      listEvents(pool, ctx.org.id, id, limit, offset),
    ]);

    return ok<IntegrationEvent[]>(events, { total, page, limit });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load integration events.", 500);
  }
});
