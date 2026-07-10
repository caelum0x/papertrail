import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { recordValidationRunSchema } from "@/lib/validation/status.schemas";
import {
  computeValidationStatus,
  recordValidationRun,
  listValidationRuns,
} from "@/lib/validation/status";

export const runtime = "nodejs";

// GET /api/validation — this org's validation runs, newest first. Any member
// (viewer+) may read the compliance history. org-scoped via ctx.org.id.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");

    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listValidationRuns(
      getPool(),
      ctx.org.id,
      limit,
      offset
    );

    return ok(items, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load validation runs.", 500);
  }
});

// POST /api/validation — compute and record a validation run for the org. The
// coverage/quality/status are derived deterministically server-side from the
// reported engines and source reachability; the client cannot set them directly.
// Recording a compliance artifact is a mutation, so editor+ is required.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const json = await req.json().catch(() => null);
    const parsed = recordValidationRunSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const status = computeValidationStatus({
      enginesRun: parsed.data.enginesRun,
      requiredEngines: parsed.data.requiredEngines,
      sourcesReachable: parsed.data.sourcesReachable,
    });

    const pool = getPool();
    const run = await recordValidationRun(
      pool,
      ctx.org.id,
      parsed.data.subject,
      status,
      parsed.data.enginesRun,
      parsed.data.sourcesReachable
    );

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "validation_run.recorded",
      entityType: "validation_run",
      entityId: run.id,
      metadata: {
        status: run.status,
        coverage: run.coverage,
        qualityScore: run.qualityScore,
      },
    });

    return created({ run, status });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to record validation run.", 500);
  }
});
