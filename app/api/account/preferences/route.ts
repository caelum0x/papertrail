import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getPool } from "@/lib/db";
import { updatePreferencesSchema } from "@/lib/account/schemas";
import { getPreferences, updatePreferences } from "@/lib/account/repository";
import type { AccountPreferences } from "@/lib/account/types";

export const runtime = "nodejs";

function statusOf(err: unknown): number | null {
  if (err instanceof Error && "status" in err) {
    return (err as { status: number }).status;
  }
  return null;
}

// GET /api/account/preferences — the current user's typed UI preferences.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const prefs = await getPreferences(ctx.org.id, ctx.user.id);
    return ok<AccountPreferences>(prefs);
  } catch (err) {
    const s = statusOf(err);
    return fail(s ? "Forbidden." : "Couldn't load your preferences. Please try again.", s ?? 500);
  }
});

// PATCH /api/account/preferences — update the current user's own preferences.
// Merges the changed keys into the existing prefs jsonb, preserving unrelated keys.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const json = await req.json().catch(() => null);
    const parsed = updatePreferencesSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }
    const input = parsed.data;

    const updated = await updatePreferences(ctx.org.id, ctx.user.id, {
      theme: input.theme,
      density: input.density,
      landingView: input.landing_view,
      emailDigest: input.email_digest,
      reducedMotion: input.reduced_motion,
    });

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "account.preferences.update",
      entityType: "user_profile",
      entityId: ctx.user.id,
      metadata: { fields: Object.keys(input) },
    });

    return ok<AccountPreferences>(updated);
  } catch (err) {
    const s = statusOf(err);
    return fail(s ? "Forbidden." : "Couldn't update your preferences. Please try again.", s ?? 500);
  }
});
