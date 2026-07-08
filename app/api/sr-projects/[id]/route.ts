import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { updateSrProjectSchema } from "../lib/schemas";
import { getSrProject, updateSrProject } from "../lib/repository";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/sr-projects/[id] — single review detail with counts. Any member reads.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid review id.", 400);
    }

    const project = await getSrProject(getPool(), ctx.org.id, id);
    if (!project) {
      return fail("Systematic review not found.", 404);
    }
    return ok(project);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load systematic review.", 500);
  }
});

// PATCH /api/sr-projects/[id] — edit metadata / advance status. Editor+.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid review id.", 400);
    }

    const json = await req.json().catch(() => null);
    const parsed = updateSrProjectSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const pool = getPool();
    const existing = await getSrProject(pool, ctx.org.id, id);
    if (!existing) {
      return fail("Systematic review not found.", 404);
    }

    const updated = await updateSrProject(pool, ctx.org.id, id, {
      name: parsed.data.name,
      question: parsed.data.question,
      inclusionCriteria: parsed.data.inclusionCriteria,
      status: parsed.data.status,
    });
    if (!updated) {
      return fail("Systematic review not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "sr_project.updated",
      entityType: "sr_project",
      entityId: id,
      metadata: { status: updated.status },
    });

    return ok(updated);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to update systematic review.", 500);
  }
});
