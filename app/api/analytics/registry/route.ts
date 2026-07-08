import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getRegistryAnalytics, type RegistryAnalytics } from "../queries";

export const runtime = "nodejs";

// GET /api/analytics/registry — distribution of registry-check outcomes for the
// org's verifications matched against ClinicalTrials.gov sources, plus registry
// coverage counts. Any member may read.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const analytics = await getRegistryAnalytics(ctx.org.id);
    return ok<RegistryAnalytics>(analytics);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't load registry analytics. Please try again.", 500);
  }
});
