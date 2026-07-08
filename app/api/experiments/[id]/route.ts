import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { updateExperimentSchema } from "@/lib/flags/schemas";
import {
  getExperimentById,
  updateExperiment,
} from "@/lib/flags/repository";
import type { Experiment } from "@/lib/flags/types";

export const runtime = "nodejs";

// GET /api/experiments/[id] — read a single experiment. Any member (viewer+).
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id) return fail("Experiment id is required.", 400);

    const experiment = await getExperimentById(getPool(), ctx.org.id, id);
    if (!experiment) return fail("Experiment not found.", 404);
    return ok<Experiment>(experiment);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load experiment.", 500);
  }
});

// PATCH /api/experiments/[id] — update name/status/variants. Admin+ only.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id) return fail("Experiment id is required.", 400);

    const json = await req.json().catch(() => null);
    const parsed = updateExperimentSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const pool = getPool();
    const updated = await updateExperiment(pool, ctx.org.id, id, {
      name: parsed.data.name,
      status: parsed.data.status,
      variants: parsed.data.variants,
    });
    if (!updated) return fail("Experiment not found.", 404);

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "experiment.updated",
      entityType: "experiment",
      entityId: updated.id,
      metadata: {
        key: updated.key,
        status: updated.status,
        variantCount: updated.variants.length,
      },
    });

    return ok<Experiment>(updated);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to update experiment.", 500);
  }
});
