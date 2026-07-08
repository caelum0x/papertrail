import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { listFactors } from "@/lib/sso/repository";
import type { MfaFactor } from "@/lib/sso/types";

export const runtime = "nodejs";

// GET /api/mfa/factors — the current user's MFA factors in the active org
// (secrets never included). Any authenticated member can manage their own MFA,
// so no elevated role is required; results are scoped to ctx.user.id.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    const pool = getPool();
    const factors = await listFactors(pool, ctx.org.id, ctx.user.id);
    return ok<MfaFactor[]>(factors, { total: factors.length });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load MFA factors.", 500);
  }
});
