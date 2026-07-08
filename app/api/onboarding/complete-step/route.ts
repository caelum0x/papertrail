import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getPool } from "@/lib/db";
import { completeStep, completeStepSchema, type OnboardingState } from "../repository";

export const runtime = "nodejs";

// POST /api/onboarding/complete-step — mark one wizard step complete for the
// caller. Idempotent per step. Any member may advance their own onboarding.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");

    const body = await req.json().catch(() => null);
    const parsed = completeStepSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const state = await completeStep(ctx.org.id, ctx.user.id, parsed.data.step);

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "onboarding.complete_step",
      entityType: "onboarding_state",
      entityId: state.id,
      metadata: { step: parsed.data.step, completed: state.completed },
    });

    return ok<OnboardingState>(state);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't save your progress. Please try again.", 500);
  }
});
