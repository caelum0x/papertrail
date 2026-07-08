import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { screenRecordSchema } from "../../../sr-projects/lib/schemas";
import { getRecord, screenRecord } from "../../../sr-projects/lib/repository";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/sr-records/[id]/screen — include/exclude a record at a stage. Editor+.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid record id.", 400);
    }

    const json = await req.json().catch(() => null);
    const parsed = screenRecordSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const pool = getPool();
    const existing = await getRecord(pool, ctx.org.id, id);
    if (!existing) {
      return fail("Record not found.", 404);
    }

    const reason = parsed.data.reason?.trim() ? parsed.data.reason.trim() : null;
    const updated = await screenRecord(
      pool,
      ctx.org.id,
      id,
      ctx.user.id,
      parsed.data.stage,
      parsed.data.decision,
      reason
    );
    if (!updated) {
      return fail("Record not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "sr_record.screened",
      entityType: "sr_record",
      entityId: id,
      metadata: {
        stage: parsed.data.stage,
        decision: parsed.data.decision,
        status: updated.status,
      },
    });

    return ok(updated);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to record screening decision.", 500);
  }
});
