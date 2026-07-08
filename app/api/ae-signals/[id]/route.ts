import { NextRequest } from "next/server";
import { z } from "zod";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import { updateAeSignalSchema } from "@/lib/monitoring/schemas";
import { updateSignal } from "@/lib/monitoring/repo";

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

// PATCH /api/ae-signals/[id] — update a signal (severity, status, notes, etc.).
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");

    const parsedId = idSchema.safeParse(params?.id);
    if (!parsedId.success) {
      return fail("Invalid signal id.", 400);
    }

    const body = await req.json().catch(() => null);
    const parsed = updateAeSignalSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid update.", 400);
    }

    const updated = await updateSignal(ctx.org.id, parsedId.data, parsed.data);
    if (!updated) {
      return fail("Signal not found.", 404);
    }

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "ae_signal.update",
      entityType: "ae_signal",
      entityId: updated.id,
      metadata: { fields: Object.keys(parsed.data) },
    });

    return ok(updated);
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't update the signal. Please try again.", 500);
  }
});
