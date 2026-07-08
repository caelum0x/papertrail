import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import { patchSecurityPolicySchema } from "@/lib/security/schemas";
import {
  listPoliciesWithDefaults,
  upsertSecurityPolicy,
} from "@/lib/security/policies";
import type { SecurityPolicy } from "@/lib/security/types";

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

// GET /api/security/policies — every known security control for the org, using
// stored config where present and disabled defaults otherwise. Admin+ only.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const policies = await listPoliciesWithDefaults(ctx.org.id);
    return ok<SecurityPolicy[]>(policies);
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't load security policies. Please try again.", 500);
  }
});

// PATCH /api/security/policies — toggle a policy and/or replace its config.
// Admin+ only (settings administration).
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");

    const body = await req.json().catch(() => null);
    const parsed = patchSecurityPolicySchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid policy.", 400);
    }

    const policy = await upsertSecurityPolicy({
      orgId: ctx.org.id,
      kind: parsed.data.kind,
      enabled: parsed.data.enabled,
      config: parsed.data.config,
    });

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "security_policy.update",
      entityType: "security_policy",
      entityId: policy.id,
      metadata: { kind: policy.kind, enabled: policy.enabled },
    });

    return ok<SecurityPolicy>(policy);
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't update the security policy. Please try again.", 500);
  }
});
