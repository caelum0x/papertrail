import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { processDocument, documentExists } from "@/lib/ingestion/pipeline";

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/documents/[id]/extract — run the ingestion pipeline over a stored
// document (its stored bytes/text), persisting pages + chunks and recording an
// extraction job. Returns a summary of the run.
export const POST = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !uuidRe.test(id)) {
      return fail("Invalid document id.", 400);
    }

    const pool = getPool();
    if (!(await documentExists(pool, ctx.org.id, id))) {
      return fail("Document not found.", 404);
    }

    // Bytes are re-extracted from stored text here (no blob store yet); passing
    // null makes the pipeline fall back to the document's stored extracted_text.
    const summary = await processDocument(null, id, ctx.org.id);

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "document.extract",
      entityType: "document",
      entityId: id,
      metadata: {
        engine: summary.engine,
        pages: summary.page_count,
        chunks: summary.chunk_count,
      },
    });

    return ok(summary);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (typeof status === "number") {
      return fail((err as Error).message, status);
    }
    return fail("Failed to run extraction pipeline.", 500);
  }
});
