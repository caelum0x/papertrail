import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import { upsertRetentionPolicySchema } from "@/lib/compliance/schemas";
import {
  listRetentionPolicies,
  upsertRetentionPolicy,
} from "@/lib/compliance/retention";
import type { RetentionPolicy } from "@/lib/compliance/types";

export const runtime = "nodejs";

function rbacStatus(err: unknown): number | null {
  if (
    err instanceof Error &&
    typeof (err as unknown as { status?: unknown }).status === "number"
  ) {
    return (err as unknown as { status: number }).status;
  }
  return null;
}

// GET /api/retention-policies — the org's data-retention policies. Admin+ only.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const policies = await listRetentionPolicies(ctx.org.id);
    return ok<RetentionPolicy[]>(policies);
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't load retention policies. Please try again.", 500);
  }
});

// POST /api/retention-policies — create or update a retention window for an
// entity type. Admin+ only (settings administration).
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");

    const body = await req.json().catch(() => null);
    const parsed = upsertRetentionPolicySchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid policy.", 400);
    }

    const policy = await upsertRetentionPolicy({
      orgId: ctx.org.id,
      entityType: parsed.data.entityType,
      retainDays: parsed.data.retainDays,
    });

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "retention_policy.upsert",
      entityType: "retention_policy",
      entityId: policy.id,
      metadata: {
        entity_type: policy.entity_type,
        retain_days: policy.retain_days,
      },
    });

    return created(policy);
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't save the retention policy. Please try again.", 500);
  }
});
