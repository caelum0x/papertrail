import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { writeAudit } from "@/lib/audit";
import { verifyMfaSchema } from "@/lib/sso/schemas";
import { getFactorSecret, markFactorVerified } from "@/lib/sso/repository";
import { verifyTotp } from "@/lib/sso/totp";
import type { MfaFactor } from "@/lib/sso/types";

export const runtime = "nodejs";

// POST /api/mfa/verify — confirm a pending TOTP factor by checking a 6-digit code
// against the stored secret. On success the factor becomes verified (usable).
// Scoped to the current user's own factors only.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    const json = await req.json().catch(() => null);
    const parsed = verifyMfaSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const factor = await getFactorSecret(
      pool,
      ctx.org.id,
      ctx.user.id,
      parsed.data.factorId
    );
    if (!factor) return fail("MFA factor not found.", 404);
    if (factor.type !== "totp") {
      return fail("This factor cannot be verified with a code.", 400);
    }

    const valid = verifyTotp(factor.secret, parsed.data.code);
    if (!valid) {
      return fail("That code didn't match. Check your app and try again.", 400);
    }

    const updated = await markFactorVerified(
      pool,
      ctx.org.id,
      ctx.user.id,
      factor.id
    );
    if (!updated) return fail("MFA factor not found.", 404);

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "mfa.verify",
      entityType: "mfa_factor",
      entityId: factor.id,
      metadata: { type: updated.type },
    });

    return ok<MfaFactor>(updated);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to verify MFA factor.", 500);
  }
});
