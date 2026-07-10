import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import { getPolicy, setPolicy } from "@/lib/governance/retention";
import { setRetentionPolicySchema } from "@/lib/governance/retention.schemas";
import type { RetentionPolicy } from "@/lib/governance/retention.schemas";

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

// GET /api/governance/retention — the org's current data-retention policy, or
// null if none has been configured (which means "keep everything forever").
// Readable by any org member.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    const policy = await getPolicy(getPool(), ctx.org.id);
    return ok<RetentionPolicy | null>(policy);
  } catch {
    return fail("Couldn't load the retention policy. Please try again.", 500);
  }
});

// PUT /api/governance/retention — set the org's retention windows. This governs
// how long evidence artifacts are legally retained before purge, so it is an
// admin-only governance action. Every field is optional; omitted fields are left
// unchanged, an explicit null clears a window to "keep forever".
export const PUT = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");

    const body = await req.json().catch(() => null);
    const parsed = setRetentionPolicySchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid retention policy.", 400);
    }

    const policy = await setPolicy(getPool(), ctx.org.id, parsed.data);

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "retention.policy.update",
      entityType: "retention_policy",
      entityId: ctx.org.id,
      metadata: {
        evidence_reports_days: policy.evidenceReportsDays,
        engine_usage_days: policy.engineUsageDays,
        audit_days: policy.auditDays,
      },
    });

    return ok<RetentionPolicy>(policy);
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't update the retention policy. Please try again.", 500);
  }
});
