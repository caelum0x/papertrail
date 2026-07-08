import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { listChainEntries } from "@/lib/compliance/chain";
import type { AuditChainEntry } from "@/lib/compliance/types";

export const runtime = "nodejs";

function rbacStatus(err: unknown): number | null {
  if (
    err instanceof Error &&
    typeof (err as unknown as { status?: unknown }).status === "number"
  ) {
    return (err as unknown as { status: number }).status;
  }
  return null;
}

// GET /api/audit-chain — paginated entries of the org's WORM hash chain, newest
// first. Admin+ only (audit visibility).
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listChainEntries({
      orgId: ctx.org.id,
      limit,
      offset,
    });
    return ok<AuditChainEntry[]>(items, { total, page, limit });
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't load the audit chain. Please try again.", 500);
  }
});
