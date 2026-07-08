import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { updateProjectSchema } from "@/lib/projects/types";
import {
  getProject,
  updateProject,
  deleteProject,
} from "@/lib/projects/queries";

function statusOf(err: unknown): number | null {
  if (err instanceof Error && "status" in err) {
    return (err as { status: number }).status;
  }
  return null;
}

// GET /api/projects/[id] — single project, org-scoped.
export const GET = withOrg(
  async (_req: NextRequest, ctx: Ctx, params) => {
    try {
      const id = params?.id;
      if (!id) return fail("Project id is required.", 400);
      const project = await getProject(getPool(), ctx.org.id, id);
      if (!project) return fail("Project not found.", 404);
      return ok(project);
    } catch {
      return fail("Failed to load project.", 500);
    }
  }
);

// PATCH /api/projects/[id] — update name/description/status (editor+). Audited.
export const PATCH = withOrg(
  async (req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "editor");
      const id = params?.id;
      if (!id) return fail("Project id is required.", 400);

      const raw = await req.json().catch(() => null);
      const parsed = updateProjectSchema.safeParse(raw);
      if (!parsed.success) {
        return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
      }

      const pool = getPool();
      const project = await updateProject(pool, ctx.org.id, id, parsed.data);
      if (!project) return fail("Project not found.", 404);

      await writeAudit(pool, {
        orgId: ctx.org.id,
        userId: ctx.user.id,
        action: "project.update",
        entityType: "project",
        entityId: project.id,
        metadata: { fields: Object.keys(parsed.data) },
      });

      return ok(project);
    } catch (err: unknown) {
      const s = statusOf(err);
      if (s) return fail((err as Error).message, s);
      return fail("Failed to update project.", 500);
    }
  }
);

// DELETE /api/projects/[id] — remove a project (admin+). Audited.
export const DELETE = withOrg(
  async (_req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "admin");
      const id = params?.id;
      if (!id) return fail("Project id is required.", 400);

      const pool = getPool();
      const existing = await getProject(pool, ctx.org.id, id);
      if (!existing) return fail("Project not found.", 404);

      const deleted = await deleteProject(pool, ctx.org.id, id);
      if (!deleted) return fail("Project not found.", 404);

      await writeAudit(pool, {
        orgId: ctx.org.id,
        userId: ctx.user.id,
        action: "project.delete",
        entityType: "project",
        entityId: id,
        metadata: { name: existing.name },
      });

      return ok({ id, deleted: true });
    } catch (err: unknown) {
      const s = statusOf(err);
      if (s) return fail((err as Error).message, s);
      return fail("Failed to delete project.", 500);
    }
  }
);
