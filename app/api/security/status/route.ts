import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getSecurityStatus } from "@/lib/security/status";
import type { SecurityStatus } from "@/lib/security/types";

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

// GET /api/security/status — RLS coverage across core tenant tables plus a
// summary of the org's configured policies and IP allowlist. Admin+ only.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const status = await getSecurityStatus(ctx.org.id);
    return ok<SecurityStatus>(status);
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't load security status. Please try again.", 500);
  }
});
