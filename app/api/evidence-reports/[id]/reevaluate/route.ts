import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { reevaluateReport } from "@/lib/evidenceReports/reeval";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function rbacStatus(err: unknown): number | null {
  if (
    err instanceof Error &&
    typeof (err as unknown as { status?: unknown }).status === "number"
  ) {
    return (err as unknown as { status: number }).status;
  }
  return null;
}

// POST /api/evidence-reports/[id]/reevaluate — re-run a saved report's pipeline
// against the CURRENT cached sources and report whether its conclusion has changed.
// Read-only: it does NOT overwrite the stored report; it returns the fresh result
// plus a diff (verdict / GRADE certainty / pooled study count) so a reviewer can see
// if a saved conclusion has gone stale as new trials were ingested.
//
// Requires editor+ (it triggers a full pipeline re-run — a privileged operation, and
// symmetric with other report mutations). Strictly org-scoped: the report is loaded
// via ctx.org.id inside reevaluateReport; a client-supplied org_id is never trusted.
// The re-evaluation is recorded in the audit log as an editor action on the entity.
export const POST = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");

    const id = params?.id;
    if (!isUuid(id)) {
      return fail("Invalid evidence report id.", 400);
    }

    const result = await reevaluateReport(getPool(), {
      orgId: ctx.org.id,
      reportId: id,
    });
    if (!result) {
      return fail("Evidence report not found.", 404);
    }

    // Audit the re-run (an editor action against the report), recording only the
    // coarse before/after signal — never the claim text or any source content.
    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "evidence_report.reevaluate",
      entityType: "evidence_report",
      entityId: id,
      metadata: {
        changed: result.changed,
        verdict_changed: result.delta.verdictChanged,
        certainty_changed: result.delta.certaintyChanged,
        k_delta: result.delta.kDelta,
      },
    });

    return ok({
      id,
      changed: result.changed,
      previous: result.previous,
      current: result.current,
      delta: result.delta,
      freshReport: result.freshReport,
    });
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't re-evaluate the evidence report. Please try again.", 500);
  }
});
