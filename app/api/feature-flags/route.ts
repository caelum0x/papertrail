import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { createFlagSchema } from "@/lib/flags/schemas";
import { listFlags, createFlag, getFlagByKey } from "@/lib/flags/repository";
import type { FeatureFlag } from "@/lib/flags/types";

export const runtime = "nodejs";

// GET /api/feature-flags — list this org's flags, newest first, paginated.
// Any member (viewer+) may read flags.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() || undefined;
    const { limit, offset, page } = parsePagination(req);

    const { items, total } = await listFlags(getPool(), {
      orgId: ctx.org.id,
      q,
      limit,
      offset,
    });
    return ok<FeatureFlag[]>(items, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load feature flags.", 500);
  }
});

// POST /api/feature-flags — create a flag. Admin+ only (flags affect all users).
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const json = await req.json().catch(() => null);
    const parsed = createFlagSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const pool = getPool();
    const existing = await getFlagByKey(pool, ctx.org.id, parsed.data.key);
    if (existing) {
      return fail("A flag with this key already exists.", 409);
    }

    const flag = await createFlag(pool, {
      orgId: ctx.org.id,
      key: parsed.data.key,
      description: parsed.data.description ?? null,
      enabled: parsed.data.enabled,
      rolloutPercent: parsed.data.rolloutPercent,
      rules: parsed.data.rules,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "feature_flag.created",
      entityType: "feature_flag",
      entityId: flag.id,
      metadata: {
        key: flag.key,
        enabled: flag.enabled,
        rolloutPercent: flag.rolloutPercent,
      },
    });

    return created<FeatureFlag>(flag);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create feature flag.", 500);
  }
});
