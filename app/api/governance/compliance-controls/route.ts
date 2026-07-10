import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { requireRole } from "@/lib/authz/rbac";
import { latestRunsByControl } from "@/lib/complianceOps/runLedger";
import { buildAccessReviewSnapshot } from "@/lib/governance/accessReview";
import type { ControlRun } from "@/lib/complianceOps/types";

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

// The read-only status payload the compliance-controls console consumes: the last
// run of each operationalized control (from the compliance_control_runs ledger)
// plus a live access-review summary. This is what turns the scheduled crons and
// admin reviews into something an operator can SEE without re-running anything.
export interface ComplianceControlsStatus {
  retentionPurge: ControlRun | null;
  chainIntegrity: ControlRun | null;
  accessReview: ControlRun | null;
  accessReviewSummary: {
    generatedAt: string;
    members: number;
    permissionGrants: number;
    customRoles: number;
    admins: number;
    owners: number;
  };
}

// GET /api/governance/compliance-controls — the last purge run, chain-integrity
// status, and access-review status for the calling org, for the console.
// Admin-only (viewing the compliance posture is an org-administration action).
// withOrg scopes every read to ctx.org.id. The access-review summary here is
// computed live (counts only) but, unlike the download route, does NOT record a
// new run — this is a passive status view, not a review generation.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");

    const pool = getPool();
    const [runs, snapshot] = await Promise.all([
      latestRunsByControl(ctx.org.id, pool),
      buildAccessReviewSnapshot(ctx.org.id, pool),
    ]);

    const status: ComplianceControlsStatus = {
      retentionPurge: runs.retention_purge ?? null,
      chainIntegrity: runs.chain_integrity ?? null,
      accessReview: runs.access_review ?? null,
      accessReviewSummary: {
        generatedAt: snapshot.generatedAt,
        members: snapshot.counts.members,
        permissionGrants: snapshot.counts.permissionGrants,
        customRoles: snapshot.counts.customRoles,
        admins: snapshot.counts.admins,
        owners: snapshot.counts.owners,
      },
    };

    return ok<ComplianceControlsStatus>(status);
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't load the compliance controls. Please try again.", 500);
  }
});
