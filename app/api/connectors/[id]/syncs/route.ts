import type { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { listSyncsQuerySchema } from "@/lib/connectors/schemas";
import { getConnector, listSyncs } from "@/lib/connectors/repo";
import { idSchema, failFromError } from "../../_lib";

export const runtime = "nodejs";

// GET /api/connectors/[id]/syncs — paginated, newest-first sync history for one
// connector. Optional ?status filter. Any member may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");

    const parsedId = idSchema.safeParse(params?.id);
    if (!parsedId.success) {
      return fail("Invalid connector id.", 400);
    }

    const { limit, offset, page } = parsePagination(req);
    const url = new URL(req.url);
    const parsed = listSyncsQuerySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid filters.", 400);
    }

    // Ensure the connector exists in this org (avoids leaking another org's ids).
    const connector = await getConnector(ctx.org.id, parsedId.data);
    if (!connector) {
      return fail("Connector not found.", 404);
    }

    const { items, total } = await listSyncs(
      ctx.org.id,
      parsedId.data,
      parsed.data.status,
      limit,
      offset
    );
    return ok(items, { total, page, limit });
  } catch (err: unknown) {
    return failFromError(err, "Failed to load sync history.");
  }
});
