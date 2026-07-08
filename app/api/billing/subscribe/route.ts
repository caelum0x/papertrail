import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import {
  getPlanByKey,
  upsertSubscription,
} from "@/lib/billing/repository";
import { periodStart, periodEnd } from "@/lib/billing/period";
import { subscribeSchema } from "@/lib/billing/schemas";
import type { Subscription } from "@/lib/billing/types";

export const runtime = "nodejs";

// POST /api/billing/subscribe — subscribe the org to a plan (selected by its
// stable key). The plan's price and limits are read server-side from the
// catalog; the client only chooses a plan key and seat count. Owner-only
// (billing is an ownership-level action per the RBAC matrix).
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "owner");

    const json = await req.json().catch(() => null);
    const parsed = subscribeSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const plan = await getPlanByKey(pool, parsed.data.planKey);
    if (!plan) {
      return fail("Unknown plan.", 404);
    }

    // New billing period starts now and runs one calendar month.
    const now = new Date();
    const start = periodStart(now, null);
    const currentPeriodEnd = periodEnd(start).toISOString();

    const subscription = await upsertSubscription(pool, {
      orgId: ctx.org.id,
      planId: plan.id,
      seats: parsed.data.seats ?? 1,
      status: "active",
      currentPeriodEnd,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "billing.subscribe",
      entityType: "subscription",
      entityId: subscription.id,
      metadata: {
        planKey: plan.key,
        seats: subscription.seats,
        priceCents: plan.priceCents,
      },
    });

    return ok<Subscription>(subscription);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to update subscription.", 500);
  }
});
