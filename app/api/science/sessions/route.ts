import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { createSessionSchema } from "@/lib/science/types";
import {
  listSessions,
  countSessions,
  createSession,
  projectExists,
} from "@/lib/science/queries";

// GET /api/science/sessions — paginated, org-scoped list of research sessions.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);
    const pool = getPool();
    const [sessions, total] = await Promise.all([
      listSessions(pool, ctx.org.id, limit, offset),
      countSessions(pool, ctx.org.id),
    ]);
    return ok(sessions, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load research sessions.", 500);
  }
});

// POST /api/science/sessions — start a research session (editor+). Audited.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const raw = await req.json().catch(() => null);
    const parsed = createSessionSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const projectId = parsed.data.projectId ?? null;
    if (projectId && !(await projectExists(pool, ctx.org.id, projectId))) {
      return fail("Project not found in this organization.", 400);
    }

    const session = await createSession(pool, {
      orgId: ctx.org.id,
      projectId,
      title: parsed.data.title,
      createdBy: ctx.user.id,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "science.session.create",
      entityType: "science_session",
      entityId: session.id,
      metadata: { title: session.title, projectId: session.projectId },
    });

    return created(session);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create research session.", 500);
  }
});
