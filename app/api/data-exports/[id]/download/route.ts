import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getExport } from "@/lib/dataexport/repository";
import { buildExport } from "@/lib/dataexport/build";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/data-exports/[id]/download — returns the serialized document for an
// export as a file download. The document is rebuilt on demand from the stored
// scope/format/params (nothing is cached on disk), so it's always org-scoped and
// consistent with the current data. Any member may read (export == read action).
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid export id.", 400);
    }

    const record = await getExport(ctx.org.id, id);
    if (!record) {
      return fail("Export not found.", 404);
    }

    const built = await buildExport(ctx.org.id, record.scope, record.format, {
      projectId: record.params?.project_id ?? null,
    });

    const filename = record.params?.filename ?? built.filename;

    return new Response(built.content, {
      status: 200,
      headers: {
        "Content-Type": built.contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Export-Row-Count": String(built.rowCount),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't download the export. Please try again.", 500);
  }
});
