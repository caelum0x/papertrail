import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getPool } from "@/lib/db";
import {
  completeStep,
  seedSample,
  type SeededSample,
} from "../repository";

export const runtime = "nodejs";

// POST /api/onboarding/seed-sample — create a demo project + demo claim for the
// active org so a new user can explore a real provenance trail. Idempotent per
// org (reuses the sample if it already exists). Requires editor+ since it writes
// project/claim rows into the shared workspace.
export const POST = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const sample = await seedSample(ctx.org.id, ctx.user.id);

    // Seeding sample data satisfies the "sample_data" wizard step. Best-effort:
    // never fail the seed just because the step marker couldn't be written.
    await completeStep(ctx.org.id, ctx.user.id, "sample_data").catch(
      () => undefined
    );

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "onboarding.seed_sample",
      entityType: "project",
      entityId: sample.project.id,
      metadata: {
        claimId: sample.claim.id,
        alreadyExisted: sample.already_existed,
      },
    });

    return created<SeededSample>(sample);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't load sample data. Please try again.", 500);
  }
});
