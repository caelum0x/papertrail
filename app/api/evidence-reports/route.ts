import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import { createEvidenceReportSchema } from "@/lib/evidenceReports/schemas";
import {
  createReport,
  listReports,
} from "@/lib/evidenceReports/repository";
import type { EvidenceReportRecord } from "@/lib/evidenceReports/types";

export const runtime = "nodejs";

// GET /api/evidence-reports — paginated, org-scoped list of persisted evidence
// reports, newest first. Any authenticated member of the org may read them.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listReports(getPool(), {
      orgId: ctx.org.id,
      limit,
      offset,
    });
    return ok<EvidenceReportRecord[]>(items, { total, page, limit });
  } catch {
    return fail("Couldn't load evidence reports. Please try again.", 500);
  }
});

// POST /api/evidence-reports — persist a composite evidence report the caller
// already computed (from the deterministic engine). We validate the body but do
// NOT recompute the science here. org_id always comes from ctx — never the client.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const body = await req.json().catch(() => null);
    const parsed = createEvidenceReportSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid evidence report.", 400);
    }

    const record = await createReport(getPool(), {
      orgId: ctx.org.id,
      createdBy: ctx.user.id,
      projectId: parsed.data.projectId ?? null,
      claim: parsed.data.claim,
      verdict: parsed.data.verdict ?? null,
      certainty: parsed.data.certainty ?? null,
      pooled: parsed.data.pooled ?? null,
      report: parsed.data.report,
    });

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "evidence_report.create",
      entityType: "evidence_report",
      entityId: record.id,
      metadata: {
        verdict: record.verdict,
        certainty: record.certainty,
        project_id: record.projectId,
      },
    });

    return created(record);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't save the evidence report. Please try again.", 500);
  }
});
