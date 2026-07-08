import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getUsageSummary } from "@/lib/billing/usage";
import type { UsageSummary } from "@/lib/billing/types";

export const runtime = "nodejs";

// GET /api/billing/usage — per-kind quota meters for the org's current billing
// period (used vs. plan cap). Any authenticated member can view usage.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    const summary = await getUsageSummary(ctx.org.id);
    return ok<UsageSummary>(summary);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load usage.", 500);
  }
});
