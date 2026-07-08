import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getOrCreateState, type OnboardingState } from "../repository";

export const runtime = "nodejs";

// GET /api/onboarding/state — the caller's onboarding progress in the active org.
// Any member may read their own state (creates an empty row on first read).
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const state = await getOrCreateState(ctx.org.id, ctx.user.id);
    return ok<OnboardingState>(state);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't load your onboarding progress. Please try again.", 500);
  }
});
