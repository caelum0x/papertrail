import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { updateFlagSchema } from "@/lib/flags/schemas";
import {
  getFlagById,
  updateFlag,
  deleteFlag,
} from "@/lib/flags/repository";
import type { FeatureFlag } from "@/lib/flags/types";

export const runtime = "nodejs";

// GET /api/feature-flags/[id] — read a single flag. Any member (viewer+).
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id) return fail("Flag id is required.", 400);

    const flag = await getFlagById(getPool(), ctx.org.id, id);
    if (!flag) return fail("Feature flag not found.", 404);
    return ok<FeatureFlag>(flag);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load feature flag.", 500);
  }
});

// PATCH /api/feature-flags/[id] — update enabled/rollout/rules/description.
// Admin+ only.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id) return fail("Flag id is required.", 400);

    const json = await req.json().catch(() => null);
    const parsed = updateFlagSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const pool = getPool();
    const updated = await updateFlag(pool, ctx.org.id, id, {
      description: parsed.data.description ?? undefined,
      enabled: parsed.data.enabled,
      rolloutPercent: parsed.data.rolloutPercent,
      rules: parsed.data.rules,
    });
    if (!updated) return fail("Feature flag not found.", 404);

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "feature_flag.updated",
      entityType: "feature_flag",
      entityId: updated.id,
      metadata: {
        key: updated.key,
        enabled: updated.enabled,
        rolloutPercent: updated.rolloutPercent,
        ruleCount: updated.rules.length,
      },
    });

    return ok<FeatureFlag>(updated);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to update feature flag.", 500);
  }
});

// DELETE /api/feature-flags/[id] — remove a flag entirely. Admin+ only.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id) return fail("Flag id is required.", 400);

    const pool = getPool();
    const removed = await deleteFlag(pool, ctx.org.id, id);
    if (!removed) return fail("Feature flag not found.", 404);

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "feature_flag.deleted",
      entityType: "feature_flag",
      entityId: removed.id,
      metadata: { key: removed.key },
    });

    return ok<FeatureFlag>(removed);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to delete feature flag.", 500);
  }
});
