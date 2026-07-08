import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { buildChecklist, getOrCreateState, type Checklist } from "../repository";

export const runtime = "nodejs";

// GET /api/onboarding/checklist — a derived view over the caller's onboarding
// state: each step with done/optional flags plus an overall percent-complete.
// Any member may read their own checklist.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const state = await getOrCreateState(ctx.org.id, ctx.user.id);
    const checklist = buildChecklist(state);
    return ok<Checklist>(checklist);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't load your checklist. Please try again.", 500);
  }
});
