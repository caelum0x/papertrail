import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { created, fail } from "@/lib/api/response";
import { writeAudit } from "@/lib/audit";
import { enrollMfaSchema } from "@/lib/sso/schemas";
import { insertFactor } from "@/lib/sso/repository";
import { generateTotpSecret, buildOtpauthUri } from "@/lib/sso/totp";
import type { MfaEnrollment } from "@/lib/sso/types";

export const runtime = "nodejs";

// POST /api/mfa/enroll — begin TOTP enrollment for the current user in the active
// org. Generates a base32 secret, stores the factor unverified, and returns the
// secret + otpauth:// URI once so the user can add it to their authenticator app.
// The factor is not usable until confirmed via POST /api/mfa/verify.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    const json = await req.json().catch(() => ({}));
    const parsed = enrollMfaSchema.safeParse(json ?? {});
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const secret = generateTotpSecret();
    const pool = getPool();
    const factor = await insertFactor(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      type: "totp",
      secret,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "mfa.enroll",
      entityType: "mfa_factor",
      entityId: factor.id,
      // Never log the secret.
      metadata: { type: factor.type },
    });

    const enrollment: MfaEnrollment = {
      factor,
      secret,
      otpauthUri: buildOtpauthUri(secret, ctx.user.email),
    };
    return created<MfaEnrollment>(enrollment);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to start MFA enrollment.", 500);
  }
});
