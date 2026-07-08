import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { createLibrarySchema } from "@/lib/references/types";
import {
  listLibraries,
  countLibraries,
  createLibrary,
  isOrgProject,
} from "@/lib/references/queries";

// GET /api/reference-libraries — paginated, org-scoped list of citation libraries.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);
    const pool = getPool();
    const [libraries, total] = await Promise.all([
      listLibraries(pool, ctx.org.id, limit, offset),
      countLibraries(pool, ctx.org.id),
    ]);
    return ok(libraries, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load reference libraries.", 500);
  }
});

// POST /api/reference-libraries — create a citation library (editor+). Audited.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const raw = await req.json().catch(() => null);
    const parsed = createLibrarySchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const projectId = parsed.data.projectId ?? null;
    if (projectId && !(await isOrgProject(pool, ctx.org.id, projectId))) {
      return fail("Project is not part of this organization.", 400);
    }

    const library = await createLibrary(pool, {
      orgId: ctx.org.id,
      name: parsed.data.name,
      projectId,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "reference_library.create",
      entityType: "reference_library",
      entityId: library.id,
      metadata: { name: library.name, projectId },
    });

    return created(library);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create reference library.", 500);
  }
});
