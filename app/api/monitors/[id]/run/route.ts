import { NextRequest } from "next/server";
import { z } from "zod";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import { getMonitorById } from "@/lib/monitoring/repo";
import { runMonitor } from "@/lib/monitoring/run";

export const runtime = "nodejs";

const idSchema = z.string().uuid();

function rbacStatus(err: unknown): number | null {
  if (
    err instanceof Error &&
    typeof (err as unknown as { status?: unknown }).status === "number"
  ) {
    return (err as unknown as { status: number }).status;
  }
  return null;
}

// POST /api/monitors/[id]/run — execute a monitor now: query PubMed /
// ClinicalTrials.gov via the shared retrieval agent and record new hits.
export const POST = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");

    const parsed = idSchema.safeParse(params?.id);
    if (!parsed.success) {
      return fail("Invalid monitor id.", 400);
    }

    const monitor = await getMonitorById(ctx.org.id, parsed.data);
    if (!monitor) {
      return fail("Monitor not found.", 404);
    }

    const result = await runMonitor(monitor);

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "monitor.run",
      entityType: "monitor",
      entityId: monitor.id,
      metadata: { considered: result.considered, new_hits: result.newHits },
    });

    return ok({
      monitor_id: monitor.id,
      considered: result.considered,
      new_hits: result.newHits,
    });
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't run the monitor. Please try again.", 500);
  }
});
