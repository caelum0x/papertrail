import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getPool } from "@/lib/db";
import {
  createReportSchema,
  reportTypeSchema,
} from "@/lib/reports-exports/schemas";
import { createReport, listReports } from "@/lib/reports-exports/repository";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/reports — paginated list of the org's saved reports.
// Optional filters: ?project_id, ?type. Any member may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");

    const url = new URL(req.url);

    const projectIdRaw = url.searchParams.get("project_id");
    if (projectIdRaw && !UUID_RE.test(projectIdRaw)) {
      return fail("Invalid project_id.", 400);
    }

    const typeRaw = url.searchParams.get("type");
    let type: ReturnType<typeof reportTypeSchema.parse> | undefined;
    if (typeRaw) {
      const parsedType = reportTypeSchema.safeParse(typeRaw);
      if (!parsedType.success) {
        return fail("Invalid report type.", 400);
      }
      type = parsedType.data;
    }

    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listReports({
      orgId: ctx.org.id,
      projectId: projectIdRaw ?? undefined,
      type,
      limit,
      offset,
    });

    return ok(items, { total, page, limit });
  } catch (err) {
    if (err instanceof Error && "status" in err) throw err;
    return fail("Couldn't load reports. Please try again.", 500);
  }
});

// POST /api/reports — create a saved report definition. Requires editor+.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const body = await req.json().catch(() => null);
    const parsed = createReportSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const report = await createReport({
      orgId: ctx.org.id,
      createdBy: ctx.user.id,
      ...parsed.data,
    });

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "report.create",
      entityType: "report",
      entityId: report.id,
      metadata: { type: report.type, project_id: report.project_id },
    });

    return created(report);
  } catch (err) {
    if (err instanceof Error && "status" in err) throw err;
    return fail("Couldn't create the report. Please try again.", 500);
  }
});
