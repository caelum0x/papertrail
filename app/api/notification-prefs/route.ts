import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import {
  getPrefs,
  upsertPrefs,
  updatePrefsSchema,
  type NotificationPrefs,
} from "@/lib/notify";

export const runtime = "nodejs";

// GET /api/notification-prefs — the current user's own delivery preferences in
// the active org. A missing row returns an empty map (receive everything).
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const prefs = await getPrefs(getPool(), ctx.org.id, ctx.user.id);
    return ok<NotificationPrefs>(prefs);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load notification preferences.", 500);
  }
});

// PATCH /api/notification-prefs — replace the current user's delivery
// preferences (full prefs map). Personal setting scoped to (org, user); a member
// can only change their own. Audited so admins can see prefs churn.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const json = await req.json().catch(() => null);
    const parsed = updatePrefsSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const updated = await upsertPrefs(
      pool,
      ctx.org.id,
      ctx.user.id,
      parsed.data.prefs
    );

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "notification_prefs.update",
      entityType: "notification_prefs",
      metadata: { types: Object.keys(parsed.data.prefs) },
    });

    return ok<NotificationPrefs>(updated);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to update notification preferences.", 500);
  }
});
