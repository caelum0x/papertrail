import { NextRequest, NextResponse } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getPool } from "@/lib/db";
import { createExportSchema } from "@/lib/reports-exports/schemas";
import {
  createExportJob,
  fetchExportDataset,
  listExportJobs,
} from "@/lib/reports-exports/repository";
import {
  contentTypeFor,
  extensionFor,
  serialize,
} from "@/lib/reports-exports/documents";

export const runtime = "nodejs";

// GET /api/exports — recent export jobs for the org (audit trail of what was
// exported, by whom, when). Paginated. Any member may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");

    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listExportJobs(ctx.org.id, limit, offset);

    return ok(items, { total, page, limit });
  } catch (err) {
    if (err instanceof Error && "status" in err) throw err;
    return fail("Couldn't load export history. Please try again.", 500);
  }
});

// POST /api/exports — run an export synchronously. Fetches org-scoped data for the
// requested type, serializes it to CSV/Markdown server-side, records an export_jobs
// row, writes an audit entry, and returns the document inline as a downloadable file.
// Requires editor+ (exporting data leaves the system).
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const body = await req.json().catch(() => null);
    const parsed = createExportSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const { type, format, project_id } = parsed.data;
    const pool = getPool();

    const dataset = await fetchExportDataset(type, {
      orgId: ctx.org.id,
      projectId: project_id ?? undefined,
    });

    const generatedAt = new Date();
    const title = `PaperTrail ${type} export`;
    const document = serialize(
      format,
      dataset.rows,
      dataset.columns,
      title,
      generatedAt
    );

    const stamp = generatedAt.toISOString().replace(/[:.]/g, "-");
    const filename = `papertrail-${type}-${stamp}.${extensionFor(format)}`;

    const job = await createExportJob({
      orgId: ctx.org.id,
      type,
      status: "complete",
      params: {
        format,
        project_id: project_id ?? null,
        row_count: dataset.rows.length,
        filename,
      },
      createdBy: ctx.user.id,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "export.create",
      entityType: "export_job",
      entityId: job.id,
      metadata: {
        type,
        format,
        project_id: project_id ?? null,
        row_count: dataset.rows.length,
      },
    });

    // Return the generated document inline as a file download. The export_jobs row
    // is the durable record; the bytes stream straight back to the caller.
    return new NextResponse(document, {
      status: 200,
      headers: {
        "Content-Type": contentTypeFor(format),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Export-Job-Id": job.id,
        "X-Export-Row-Count": String(dataset.rows.length),
      },
    });
  } catch (err) {
    if (err instanceof Error && "status" in err) throw err;
    return fail("Couldn't run the export. Please try again.", 500);
  }
});
