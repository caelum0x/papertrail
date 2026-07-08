import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { updateDefinitionSchema, isUuid } from "@/lib/reporting/types";
import {
  getDefinition,
  updateDefinition,
  deleteDefinition,
  findDefinitionByName,
} from "@/lib/reporting/queries";

// GET /api/report-definitions/[id] — fetch a single definition in the org.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!isUuid(id)) {
      return fail("Invalid report id.", 400);
    }
    const pool = getPool();
    const definition = await getDefinition(pool, ctx.org.id, id);
    if (!definition) {
      return fail("Report not found.", 404);
    }
    return ok(definition);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load report definition.", 500);
  }
});

// PATCH /api/report-definitions/[id] — update name/type/layout/filters (editor+).
// Guards against name collisions within the org. Audited.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!isUuid(id)) {
      return fail("Invalid report id.", 400);
    }

    const raw = await req.json().catch(() => null);
    const parsed = updateDefinitionSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const existing = await getDefinition(pool, ctx.org.id, id);
    if (!existing) {
      return fail("Report not found.", 404);
    }

    if (parsed.data.name !== undefined) {
      const duplicate = await findDefinitionByName(pool, ctx.org.id, parsed.data.name);
      if (duplicate && duplicate.id !== id) {
        return fail("A report with this name already exists.", 409);
      }
    }

    const updated = await updateDefinition(pool, ctx.org.id, id, {
      name: parsed.data.name,
      type: parsed.data.type,
      layout: parsed.data.layout,
      filters: parsed.data.filters,
    });
    if (!updated) {
      return fail("Report not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "report_definition.update",
      entityType: "report_definition",
      entityId: id,
      metadata: { name: updated.name, type: updated.type },
    });

    return ok(updated);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to update report definition.", 500);
  }
});

// DELETE /api/report-definitions/[id] — remove a definition (editor+). Cascades
// to its runs and schedule via FK. Audited.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!isUuid(id)) {
      return fail("Invalid report id.", 400);
    }

    const pool = getPool();
    const existing = await getDefinition(pool, ctx.org.id, id);
    if (!existing) {
      return fail("Report not found.", 404);
    }

    const removed = await deleteDefinition(pool, ctx.org.id, id);
    if (!removed) {
      return fail("Report not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "report_definition.delete",
      entityType: "report_definition",
      entityId: id,
      metadata: { name: existing.name, type: existing.type },
    });

    return ok({ id, deleted: true });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to delete report definition.", 500);
  }
});
