import type { NextRequest } from "next/server";
import { z } from "zod";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { requireRole } from "@/lib/authz/rbac";
import { deleteExperiment, getExperiment } from "@/lib/labNotebook/repository";

export const runtime = "nodejs";

const idSchema = z.string().uuid();

// GET /api/lab-notebook/[id] — one full experiment record, org-scoped. Any member reads.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const parsed = idSchema.safeParse(params?.id);
    if (!parsed.success) {
      return fail("Invalid experiment id.", 400);
    }

    const record = await getExperiment(getPool(), ctx.org.id, parsed.data);
    if (!record) {
      return fail("Experiment not found.", 404);
    }
    return ok(record);
  } catch (err) {
    console.error("[/api/lab-notebook/:id] get failed:", err);
    return fail("Failed to load experiment.", 500);
  }
});

// DELETE /api/lab-notebook/[id] — remove one experiment, org-scoped. Editor+.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  requireRole(ctx, "editor");

  const parsed = idSchema.safeParse(params?.id);
  if (!parsed.success) {
    return fail("Invalid experiment id.", 400);
  }

  try {
    const removed = await deleteExperiment(getPool(), ctx.org.id, parsed.data);
    if (!removed) {
      return fail("Experiment not found.", 404);
    }
    return ok({ id: parsed.data, deleted: true });
  } catch (err) {
    console.error("[/api/lab-notebook/:id] delete failed:", err);
    return fail("Couldn't delete this experiment. Please try again.", 500);
  }
});
