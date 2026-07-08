import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import {
  countAuditEntries,
  listAuditEntries,
  getAuditFilterOptions,
} from "@/lib/admin-audit/repository";
import { auditFilterSchema } from "@/lib/admin-audit/schemas";
import type { AuditLogEntry, AuditFilterOptions } from "@/lib/admin-audit/types";

export const runtime = "nodejs";

export interface AuditListResponse {
  entries: AuditLogEntry[];
  filters: AuditFilterOptions;
}

// GET /api/audit — paginated org audit log with optional action/entityType/userId
// filters plus the distinct filter options for the viewer. Admin+ only.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const url = new URL(req.url);
    const parsed = auditFilterSchema.safeParse({
      action: url.searchParams.get("action") ?? undefined,
      entityType: url.searchParams.get("entityType") ?? undefined,
      userId: url.searchParams.get("userId") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid filter.", 400);
    }

    const pool = getPool();
    const { limit, offset, page } = parsePagination(req);
    const [total, entries, filters] = await Promise.all([
      countAuditEntries(pool, ctx.org.id, parsed.data),
      listAuditEntries(pool, ctx.org.id, parsed.data, limit, offset),
      getAuditFilterOptions(pool, ctx.org.id),
    ]);

    return ok<AuditListResponse>({ entries, filters }, { total, page, limit });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load audit log.", 500);
  }
});
