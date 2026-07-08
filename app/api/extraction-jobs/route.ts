import { NextRequest } from "next/server";
import { z } from "zod";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import {
  listJobs,
  processDocument,
  documentExists,
} from "@/lib/ingestion/pipeline";

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const createJobSchema = z.object({
  document_id: z.string().uuid(),
});

// GET /api/extraction-jobs — paginated list of extraction jobs for the org.
// Optional ?document_id filter.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);
    const rawDocId = new URL(req.url).searchParams.get("document_id");
    if (rawDocId && !uuidRe.test(rawDocId)) {
      return fail("Invalid document_id filter.", 400);
    }

    const { jobs, total } = await listJobs(getPool(), ctx.org.id, {
      limit,
      offset,
      documentId: rawDocId,
    });

    return ok(jobs, { total, page, limit });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (typeof status === "number") {
      return fail((err as Error).message, status);
    }
    return fail("Failed to list extraction jobs.", 500);
  }
});

// POST /api/extraction-jobs — enqueue + run an extraction job for a document.
// Runs the pipeline synchronously and returns the resulting job/summary.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const json = await req.json().catch(() => null);
    const parsed = createJobSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    if (!(await documentExists(pool, ctx.org.id, parsed.data.document_id))) {
      return fail("Document not found.", 404);
    }

    const summary = await processDocument(
      null,
      parsed.data.document_id,
      ctx.org.id
    );

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "extraction_job.create",
      entityType: "extraction_job",
      entityId: summary.job.id,
      metadata: {
        document_id: parsed.data.document_id,
        engine: summary.engine,
        pages: summary.page_count,
      },
    });

    return created(summary);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (typeof status === "number") {
      return fail((err as Error).message, status);
    }
    return fail("Failed to create extraction job.", 500);
  }
});
