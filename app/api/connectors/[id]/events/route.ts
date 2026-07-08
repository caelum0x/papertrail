import type { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { listEventsQuerySchema } from "@/lib/connectors/schemas";
import { getConnector, listEvents } from "@/lib/connectors/repo";
import { idSchema, failFromError } from "../../_lib";

export const runtime = "nodejs";

// GET /api/connectors/[id]/events — paginated, newest-first event log for one
// connector (payloads already redacted at write time). Optional ?direction
// filter. Any member may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");

    const parsedId = idSchema.safeParse(params?.id);
    if (!parsedId.success) {
      return fail("Invalid connector id.", 400);
    }

    const { limit, offset, page } = parsePagination(req);
    const url = new URL(req.url);
    const parsed = listEventsQuerySchema.safeParse({
      direction: url.searchParams.get("direction") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid filters.", 400);
    }

    const connector = await getConnector(ctx.org.id, parsedId.data);
    if (!connector) {
      return fail("Connector not found.", 404);
    }

    const { items, total } = await listEvents(
      ctx.org.id,
      parsedId.data,
      parsed.data.direction,
      limit,
      offset
    );
    return ok(items, { total, page, limit });
  } catch (err: unknown) {
    return failFromError(err, "Failed to load connector events.");
  }
});
