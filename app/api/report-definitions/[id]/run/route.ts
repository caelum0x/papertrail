import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { runDefinitionSchema, isUuid } from "@/lib/reporting/types";
import { getDefinition, createRun } from "@/lib/reporting/queries";
import { composeReport } from "@/lib/reporting/composer";

// POST /api/report-definitions/[id]/run — compose org-scoped data into a report
// result and persist it as a report_run (editor+). The composition only reads
// rows scoped to ctx.org.id. On composition failure we still record a `failed`
// run so the run history reflects the attempt rather than silently dropping it.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!isUuid(id)) {
      return fail("Invalid report id.", 400);
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = runDefinitionSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const definition = await getDefinition(pool, ctx.org.id, id);
    if (!definition) {
      return fail("Report not found.", 404);
    }

    try {
      const result = await composeReport(pool, ctx.org.id, definition);
      const run = await createRun(pool, {
        orgId: ctx.org.id,
        definitionId: definition.id,
        createdBy: ctx.user.id,
        status: "complete",
        result,
        format: parsed.data.format,
        error: null,
      });

      await writeAudit(pool, {
        orgId: ctx.org.id,
        userId: ctx.user.id,
        action: "report_run.create",
        entityType: "report_run",
        entityId: run.id,
        metadata: { definitionId: definition.id, format: run.format, status: run.status },
      });

      return created(run);
    } catch {
      // Composition failed: record a failed run so history stays honest, then
      // surface the failure to the caller rather than fabricating a result.
      const failedRun = await createRun(pool, {
        orgId: ctx.org.id,
        definitionId: definition.id,
        createdBy: ctx.user.id,
        status: "failed",
        result: null,
        format: parsed.data.format,
        error: "Report composition failed.",
      });

      await writeAudit(pool, {
        orgId: ctx.org.id,
        userId: ctx.user.id,
        action: "report_run.failed",
        entityType: "report_run",
        entityId: failedRun.id,
        metadata: { definitionId: definition.id },
      });

      return fail("Report composition failed.", 500);
    }
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to run report.", 500);
  }
});
