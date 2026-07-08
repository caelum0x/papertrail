import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import {
  createSrProjectSchema,
  SR_PROJECT_STATUSES,
} from "./lib/schemas";
import { listSrProjects, createSrProject } from "./lib/repository";
import type { SrProjectStatus } from "./lib/types";

function parseStatus(value: string | null): SrProjectStatus | undefined {
  if (value && (SR_PROJECT_STATUSES as readonly string[]).includes(value)) {
    return value as SrProjectStatus;
  }
  return undefined;
}

// GET /api/sr-projects — list systematic reviews for the org. Any member reads.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");

    const url = new URL(req.url);
    const status = parseStatus(url.searchParams.get("status"));
    const { limit, offset, page } = parsePagination(req);

    const { items, total } = await listSrProjects(getPool(), {
      orgId: ctx.org.id,
      status,
      limit,
      offset,
    });

    return ok(items, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load systematic reviews.", 500);
  }
});

// POST /api/sr-projects — start a new systematic review. Editors and above.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const json = await req.json().catch(() => null);
    const parsed = createSrProjectSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const pool = getPool();
    const project = await createSrProject(pool, {
      orgId: ctx.org.id,
      projectId: parsed.data.projectId ?? null,
      name: parsed.data.name,
      question: parsed.data.question,
      inclusionCriteria: parsed.data.inclusionCriteria,
      createdBy: ctx.user.id,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "sr_project.created",
      entityType: "sr_project",
      entityId: project.id,
      metadata: { name: project.name },
    });

    return created(project);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create systematic review.", 500);
  }
});
