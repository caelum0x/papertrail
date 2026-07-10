import { NextRequest, NextResponse } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import { buildAccessReviewSnapshot } from "@/lib/governance/accessReview";
import { recordControlRun } from "@/lib/complianceOps/runLedger";
import type { AccessReviewSnapshot } from "@/lib/complianceOps/types";

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

// GET /api/governance/access-review — the org's full access-review snapshot:
// every role and permission grant, assembled for a periodic (e.g. quarterly)
// access review. Reviewing WHO has access is an org-administration action, so it
// is admin-only (requireRole 'admin'). withOrg already scopes every query to
// ctx.org.id, so a caller can never read another tenant's grants.
//
// With `?download=1` the same snapshot is returned as an attachment (a
// self-describing JSON artifact a reviewer can archive as evidence). Generating a
// snapshot is itself an auditable governance event, so each generation is audited
// and recorded in the compliance_control_runs ledger (counts only — the ledger
// never stores the grant listing).
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");

    const pool = getPool();
    const snapshot = await buildAccessReviewSnapshot(ctx.org.id, pool);

    // Audit + record the review generation (counts only).
    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "compliance.access_review.generate",
      entityType: "access_review",
      entityId: ctx.org.id,
      metadata: {
        members: snapshot.counts.members,
        permission_grants: snapshot.counts.permissionGrants,
        custom_roles: snapshot.counts.customRoles,
        admins: snapshot.counts.admins,
        owners: snapshot.counts.owners,
      },
    });

    await recordControlRun(
      {
        orgId: ctx.org.id,
        control: "access_review",
        status: "ok",
        detail: {
          members: snapshot.counts.members,
          permission_grants: snapshot.counts.permissionGrants,
          custom_roles: snapshot.counts.customRoles,
          admins: snapshot.counts.admins,
          owners: snapshot.counts.owners,
        },
      },
      pool
    );

    const url = new URL(req.url);
    if (url.searchParams.get("download") === "1") {
      const filename = `access-review-${ctx.org.id}-${snapshot.generatedAt.slice(0, 10)}.json`;
      return new NextResponse(JSON.stringify(snapshot, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return ok<AccessReviewSnapshot>(snapshot);
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't build the access review. Please try again.", 500);
  }
});
