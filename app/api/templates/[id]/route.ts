import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getPool } from "@/lib/db";
import {
  deleteTemplate,
  getTemplate,
  updateTemplate,
  updateTemplateSchema,
  type Template,
} from "../repository";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/templates/[id] — a single template. Any member may read.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid template id.", 400);
    }

    const template = await getTemplate(ctx.org.id, id);
    if (!template) {
      return fail("Template not found.", 404);
    }
    return ok<Template>(template);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't load the template. Please try again.", 500);
  }
});

// PATCH /api/templates/[id] — update name/description/category/body. Requires
// editor+. Kind is immutable.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid template id.", 400);
    }

    const body = await req.json().catch(() => null);
    const parsed = updateTemplateSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const template = await updateTemplate(ctx.org.id, id, parsed.data);
    if (!template) {
      return fail("Template not found.", 404);
    }

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "template.update",
      entityType: "template",
      entityId: id,
      metadata: { fields: Object.keys(parsed.data) },
    });

    return ok<Template>(template);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't update the template. Please try again.", 500);
  }
});

// DELETE /api/templates/[id] — remove a template. Requires editor+.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid template id.", 400);
    }

    const removed = await deleteTemplate(ctx.org.id, id);
    if (!removed) {
      return fail("Template not found.", 404);
    }

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "template.delete",
      entityType: "template",
      entityId: id,
    });

    return ok({ deleted: true });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't delete the template. Please try again.", 500);
  }
});
