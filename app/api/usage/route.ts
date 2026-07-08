import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getUsageMetrics } from "@/lib/admin-audit/repository";
import type { UsageMetrics } from "@/lib/admin-audit/types";

export const runtime = "nodejs";

// GET /api/usage — aggregate usage counts for the current org (claims,
// verifications, documents, members, api keys, audit events + breakdowns).
// Admin+ only.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const pool = getPool();
    const metrics = await getUsageMetrics(pool, ctx.org.id);
    return ok<UsageMetrics>(metrics);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load usage metrics.", 500);
  }
});
