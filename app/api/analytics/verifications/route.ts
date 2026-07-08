import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import {
  clampRangeDays,
  getVerificationAnalytics,
  type VerificationAnalytics,
} from "../queries";

export const runtime = "nodejs";

// GET /api/analytics/verifications — verification time series plus discrepancy-type
// and trust-score breakdowns over an optional ?range_days window (1..365, default
// 30). Any member may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");

    const url = new URL(req.url);
    const raw = url.searchParams.get("range_days");
    if (raw !== null && !/^\d+$/.test(raw)) {
      return fail("range_days must be a positive integer.", 400);
    }
    const rangeDays = clampRangeDays(raw !== null ? Number(raw) : undefined);

    const analytics = await getVerificationAnalytics(ctx.org.id, rangeDays);
    return ok<VerificationAnalytics>(analytics);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't load verification analytics. Please try again.", 500);
  }
});
