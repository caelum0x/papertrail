import { NextRequest, NextResponse } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { EXPORT_FORMATS, type ExportFormat } from "@/lib/references/types";
import { serializeReferences } from "@/lib/references/formats";
import {
  getLibrary,
  listAllReferencesForExport,
} from "@/lib/references/queries";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isExportFormat(value: string | null): value is ExportFormat {
  return value !== null && (EXPORT_FORMATS as readonly string[]).includes(value);
}

// GET /api/references/export?libraryId=&format=bibtex|ris|csv — serialize a whole
// library and stream it back as a downloadable file. Any member may export.
// Audited (data leaving the system).
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");

    const url = new URL(req.url);
    const libraryId = url.searchParams.get("libraryId");
    if (!libraryId || !UUID_RE.test(libraryId)) {
      return fail("A valid libraryId is required.", 400);
    }
    const format = url.searchParams.get("format") ?? "bibtex";
    if (!isExportFormat(format)) {
      return fail("format must be one of bibtex, ris, csv.", 400);
    }

    const pool = getPool();
    const library = await getLibrary(pool, ctx.org.id, libraryId);
    if (!library) {
      return fail("Reference library not found.", 404);
    }

    const references = await listAllReferencesForExport(pool, ctx.org.id, libraryId);
    const document = serializeReferences(format, references);

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const slug = library.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "library";
    const filename = `papertrail-${slug}-${stamp}.${document.extension}`;

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "reference.export",
      entityType: "reference_library",
      entityId: libraryId,
      metadata: { format, count: references.length },
    });

    return new NextResponse(document.body, {
      status: 200,
      headers: {
        "Content-Type": document.contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Reference-Count": String(references.length),
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to export references.", 500);
  }
});
