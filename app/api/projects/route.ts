import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { createProjectSchema } from "@/lib/projects/types";
import {
  listProjects,
  countProjects,
  createProject,
} from "@/lib/projects/queries";

// GET /api/projects — paginated, org-scoped list of the org's projects.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const pool = getPool();
    const [projects, total] = await Promise.all([
      listProjects(pool, ctx.org.id, limit, offset),
      countProjects(pool, ctx.org.id),
    ]);
    return ok(projects, { total, page, limit });
  } catch {
    return fail("Failed to load projects.", 500);
  }
});

// POST /api/projects — create a project (editor+). Audited on success.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const raw = await req.json().catch(() => null);
    const parsed = createProjectSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const project = await createProject(pool, {
      orgId: ctx.org.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      createdBy: ctx.user.id,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "project.create",
      entityType: "project",
      entityId: project.id,
      metadata: { name: project.name },
    });

    return created(project);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create project.", 500);
  }
});
