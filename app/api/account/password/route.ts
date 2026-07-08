import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getPool } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { updatePasswordSchema } from "@/lib/account/schemas";
import { getPasswordHash, setPasswordHash } from "@/lib/account/repository";

export const runtime = "nodejs";

function statusOf(err: unknown): number | null {
  if (err instanceof Error && "status" in err) {
    return (err as { status: number }).status;
  }
  return null;
}

// PATCH /api/account/password — change the current user's own password. Requires
// the correct current password (verified server-side); never leaks whether the
// account exists (the user is already authenticated) but does distinguish a wrong
// current password with a 400 so the UI can prompt correctly. Never logs either
// password value.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const json = await req.json().catch(() => null);
    const parsed = updatePasswordSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }
    const { current_password, new_password } = parsed.data;

    const currentHash = await getPasswordHash(ctx.user.id);
    if (!currentHash) {
      return fail("Couldn't verify your account. Please sign in again.", 401);
    }

    const matches = await verifyPassword(current_password, currentHash);
    if (!matches) {
      return fail("Current password is incorrect.", 400);
    }

    const nextHash = await hashPassword(new_password);
    await setPasswordHash(ctx.user.id, nextHash);

    // Audit the fact of the change only — never the password itself.
    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "account.password.change",
      entityType: "user",
      entityId: ctx.user.id,
      metadata: {},
    });

    return ok<{ changed: true }>({ changed: true });
  } catch (err) {
    const s = statusOf(err);
    return fail(s ? "Forbidden." : "Couldn't change your password. Please try again.", s ?? 500);
  }
});
