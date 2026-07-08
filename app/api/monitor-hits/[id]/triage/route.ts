import { NextRequest } from "next/server";
import { z } from "zod";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import { triageHitSchema } from "@/lib/monitoring/schemas";
import { updateHitStatus } from "@/lib/monitoring/repo";

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

// POST /api/monitor-hits/[id]/triage — set a hit's triage status
// (relevant / dismissed / escalated / new).
export const POST = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");

    const parsedId = idSchema.safeParse(params?.id);
    if (!parsedId.success) {
      return fail("Invalid hit id.", 400);
    }

    const body = await req.json().catch(() => null);
    const parsed = triageHitSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid triage.", 400);
    }

    const updated = await updateHitStatus(
      ctx.org.id,
      parsedId.data,
      parsed.data.status
    );
    if (!updated) {
      return fail("Hit not found.", 404);
    }

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "monitor_hit.triage",
      entityType: "monitor_hit",
      entityId: updated.id,
      metadata: { status: updated.status },
    });

    return ok(updated);
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't triage the hit. Please try again.", 500);
  }
});
