import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { exportOrgEvidence } from "@/lib/governance/retention";
import type { EvidenceExportBundle } from "@/lib/governance/retention.schemas";

export const runtime = "nodejs";

// GET /api/governance/export — a DSAR-style portability export of the org's
// evidence artifacts as one JSON bundle. Everything is org-scoped, so a member
// can only ever export their own org's data. Producing the bundle is itself a
// governance-relevant event, so we record it in the audit trail (counts only —
// never the artifact contents or any claim text).
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    const bundle = await exportOrgEvidence(getPool(), ctx.org.id);

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "governance.export",
      entityType: "evidence_export",
      entityId: ctx.org.id,
      metadata: {
        evidence_reports: bundle.counts.evidenceReports,
        engine_usage: bundle.counts.engineUsage,
      },
    });

    return ok<EvidenceExportBundle>(bundle);
  } catch {
    return fail("Couldn't build the evidence export. Please try again.", 500);
  }
});
