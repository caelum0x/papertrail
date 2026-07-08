import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { requireRole } from "@/lib/authz/rbac";
import { documentExists, getLatestJob } from "@/lib/ingestion/pipeline";
import { getDocumentText } from "@/lib/documents/repository";

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/documents/[id]/pages — per-page text plus the latest extraction job so
// the pipeline viewer can show status alongside the pages.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !uuidRe.test(id)) {
      return fail("Invalid document id.", 400);
    }

    const pool = getPool();
    if (!(await documentExists(pool, ctx.org.id, id))) {
      return fail("Document not found.", 404);
    }

    const text = await getDocumentText(pool, ctx.org.id, id);
    const job = await getLatestJob(pool, ctx.org.id, id);

    return ok({
      pages: text?.pages ?? [],
      latest_job: job,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (typeof status === "number") {
      return fail((err as Error).message, status);
    }
    return fail("Failed to load document pages.", 500);
  }
});
