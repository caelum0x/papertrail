import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getPool } from "@/lib/db";
import { duplicateTemplate, type Template } from "../../repository";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/templates/[id]/duplicate — clone a template into a new row. Requires
// editor+.
export const POST = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid template id.", 400);
    }

    const copy = await duplicateTemplate(ctx.org.id, id, ctx.user.id);
    if (!copy) {
      return fail("Template not found.", 404);
    }

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "template.duplicate",
      entityType: "template",
      entityId: copy.id,
      metadata: { sourceId: id, name: copy.name },
    });

    return created<Template>(copy);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't duplicate the template. Please try again.", 500);
  }
});
