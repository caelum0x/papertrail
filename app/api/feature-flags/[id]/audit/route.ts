import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import {
  getFlagById,
  listFlagAudit,
  type FlagAuditEntry,
} from "@/lib/flags/repository";

export const runtime = "nodejs";

// GET /api/feature-flags/[id]/audit — recent audit-log entries for one flag.
// Viewing audit is an admin capability, so require admin+ (matches rbac's
// "view_audit" minimum).
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id) return fail("Flag id is required.", 400);

    const pool = getPool();
    const flag = await getFlagById(pool, ctx.org.id, id);
    if (!flag) return fail("Feature flag not found.", 404);

    const entries = await listFlagAudit(pool, ctx.org.id, id, 25);
    return ok<FlagAuditEntry[]>(entries);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load flag history.", 500);
  }
});
