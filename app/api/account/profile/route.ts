import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getPool } from "@/lib/db";
import { updateProfileSchema } from "@/lib/account/schemas";
import { getProfile, updateProfile } from "@/lib/account/repository";
import type { AccountProfile } from "@/lib/account/types";

export const runtime = "nodejs";

function statusOf(err: unknown): number | null {
  if (err instanceof Error && "status" in err) {
    return (err as { status: number }).status;
  }
  return null;
}

// GET /api/account/profile — the current user's own profile in the active org.
// Personal surface: any member may read their own profile (viewer+).
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const profile = await getProfile(ctx.org.id, ctx.user);
    return ok<AccountProfile>(profile);
  } catch (err) {
    const s = statusOf(err);
    return fail(s ? "Forbidden." : "Couldn't load your profile. Please try again.", s ?? 500);
  }
});

// PATCH /api/account/profile — update the current user's own profile. A member may
// always edit their own profile (viewer+); this is not an org-admin action.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const json = await req.json().catch(() => null);
    const parsed = updateProfileSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }
    const input = parsed.data;

    const updated = await updateProfile(ctx.org.id, ctx.user, {
      name: input.name,
      displayName: input.display_name,
      title: input.title,
      avatarUrl: input.avatar_url,
    });

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "account.profile.update",
      entityType: "user_profile",
      entityId: ctx.user.id,
      metadata: { fields: Object.keys(input) },
    });

    return ok<AccountProfile>(updated);
  } catch (err) {
    const s = statusOf(err);
    return fail(s ? "Forbidden." : "Couldn't update your profile. Please try again.", s ?? 500);
  }
});
