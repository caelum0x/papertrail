import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { getReport, deleteReport } from "@/lib/evidenceReports/repository";
import type { EvidenceReportRecord } from "@/lib/evidenceReports/types";

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

// GET /api/evidence-reports/[id] — fetch a single persisted report in the org.
// Any authenticated member may read. Returns 404 for ids in another tenant.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    const id = params?.id;
    if (!isUuid(id)) {
      return fail("Invalid evidence report id.", 400);
    }
    const record = await getReport(getPool(), ctx.org.id, id);
    if (!record) {
      return fail("Evidence report not found.", 404);
    }
    return ok<EvidenceReportRecord>(record);
  } catch {
    return fail("Couldn't load the evidence report. Please try again.", 500);
  }
});

// DELETE /api/evidence-reports/[id] — remove a persisted report from the org.
// Requires editor+ (a mutation). Scoped to ctx.org.id so a caller can never
// delete another tenant's report.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!isUuid(id)) {
      return fail("Invalid evidence report id.", 400);
    }
    const removed = await deleteReport(getPool(), ctx.org.id, id);
    if (!removed) {
      return fail("Evidence report not found.", 404);
    }

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "evidence_report.delete",
      entityType: "evidence_report",
      entityId: id,
    });

    return ok<{ id: string }>({ id });
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't delete the evidence report. Please try again.", 500);
  }
});
