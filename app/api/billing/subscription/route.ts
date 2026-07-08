import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getActiveSubscription } from "@/lib/billing/repository";
import type { Subscription } from "@/lib/billing/types";

export const runtime = "nodejs";

// GET /api/billing/subscription — the org's current subscription (with plan),
// or null if it has never subscribed (i.e. it is on the implicit free tier).
// Any authenticated member can view the org's plan.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    const pool = getPool();
    const subscription = await getActiveSubscription(pool, ctx.org.id);
    return ok<Subscription | null>(subscription);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load subscription.", 500);
  }
});
