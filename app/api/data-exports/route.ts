import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getPool } from "@/lib/db";
import { createExportSchema, exportScopeSchema } from "@/lib/dataexport/schemas";
import { createExport, listExports } from "@/lib/dataexport/repository";
import { buildExport } from "@/lib/dataexport/build";

export const runtime = "nodejs";

// GET /api/data-exports — paginated list of the org's exports. Optional filter:
// ?scope. Any member may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");

    const url = new URL(req.url);
    const scopeRaw = url.searchParams.get("scope");
    let scope: ReturnType<typeof exportScopeSchema.parse> | undefined;
    if (scopeRaw) {
      const parsed = exportScopeSchema.safeParse(scopeRaw);
      if (!parsed.success) {
        return fail("Invalid export scope.", 400);
      }
      scope = parsed.data;
    }

    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listExports({
      orgId: ctx.org.id,
      scope,
      limit,
      offset,
    });

    return ok(items, { total, page, limit });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't load exports. Please try again.", 500);
  }
});

// POST /api/data-exports — start (build + record) an export. Requires editor+.
// Builds the document synchronously so row_count is exact, records a completed
// data_exports row, and returns it. Download is a separate route.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const body = await req.json().catch(() => null);
    const parsed = createExportSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const { scope, format, project_id } = parsed.data;

    const built = await buildExport(ctx.org.id, scope, format, {
      projectId: project_id ?? null,
    });

    const record = await createExport({
      orgId: ctx.org.id,
      scope,
      format,
      status: "complete",
      rowCount: built.rowCount,
      params: { project_id: project_id ?? null, filename: built.filename },
      createdBy: ctx.user.id,
    });

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "data_export.create",
      entityType: "data_export",
      entityId: record.id,
      metadata: { scope, format, row_count: built.rowCount },
    });

    return created(record);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't start the export. Please try again.", 500);
  }
});
