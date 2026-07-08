import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { countToolCalls, listToolCalls } from "@/lib/tools/repository";
import type { ToolCall } from "@/lib/tools/types";

export const runtime = "nodejs";

// GET /api/tools/calls — paginated history of this org's tool invocations,
// newest-first. Org-scoped; any member (viewer+) may read the history.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const pool = getPool();
    const { limit, offset, page } = parsePagination(req);
    const [total, calls] = await Promise.all([
      countToolCalls(pool, ctx.org.id),
      listToolCalls(pool, ctx.org.id, limit, offset),
    ]);
    return ok<ToolCall[]>(calls, { total, page, limit });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load tool call history.", 500);
  }
});
