import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { verifyChain } from "@/lib/compliance/chain";
import type { ChainVerification } from "@/lib/compliance/types";

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

// GET /api/audit-chain/verify — recompute the org's chain end-to-end and report
// whether it is intact (and where the first break is, if any). Admin+ only.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const result = await verifyChain(ctx.org.id);
    return ok<ChainVerification>(result);
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't verify the audit chain. Please try again.", 500);
  }
});
