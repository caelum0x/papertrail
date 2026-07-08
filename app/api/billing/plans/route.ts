import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { listPlans } from "@/lib/billing/repository";
import type { Plan } from "@/lib/billing/types";

export const runtime = "nodejs";

// GET /api/billing/plans — the global plan catalog (ordered cheapest first).
// Any authenticated member of the org can view available plans.
export const GET = withOrg(async (_req: NextRequest, _ctx: Ctx) => {
  try {
    const pool = getPool();
    const plans = await listPlans(pool);
    return ok<Plan[]>(plans);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load plans.", 500);
  }
});
