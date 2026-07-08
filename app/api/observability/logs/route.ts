import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { logsQuerySchema } from "@/lib/observability/schemas";
import { listLogs } from "@/lib/observability/queries";

export const runtime = "nodejs";

// GET /api/observability/logs — unified recent feed merging error_events and
// audit_log, newest first. Query: ?source=all|error|audit&level=&q=. Paginated.
// Viewing the audit trail is admin-gated, so this route requires admin.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const url = new URL(req.url);
    const parsed = logsQuerySchema.safeParse({
      source: url.searchParams.get("source") ?? undefined,
      level: url.searchParams.get("level") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid query.", 400);
    }

    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listLogs(
      getPool(),
      ctx.org.id,
      parsed.data,
      limit,
      offset
    );
    return ok(items, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load logs.", 500);
  }
});
