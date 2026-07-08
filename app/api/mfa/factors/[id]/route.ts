import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { writeAudit } from "@/lib/audit";
import { deleteFactor } from "@/lib/sso/repository";
import type { MfaFactor } from "@/lib/sso/types";

export const runtime = "nodejs";

// DELETE /api/mfa/factors/[id] — remove one of the current user's MFA factors
// (e.g. a lost authenticator). Scoped to ctx.user.id so a user can only delete
// their own factors.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    const id = params?.id;
    if (!id) return fail("Factor id is required.", 400);

    const pool = getPool();
    const deleted = await deleteFactor(pool, ctx.org.id, ctx.user.id, id);
    if (!deleted) return fail("MFA factor not found.", 404);

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "mfa.delete",
      entityType: "mfa_factor",
      entityId: id,
      metadata: { type: deleted.type },
    });

    return ok<MfaFactor>(deleted);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to delete MFA factor.", 500);
  }
});
