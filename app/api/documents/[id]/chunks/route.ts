import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { requireRole } from "@/lib/authz/rbac";
import { documentExists, listChunks } from "@/lib/ingestion/pipeline";

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/documents/[id]/chunks — paginated retrieval chunks produced by the
// pipeline, ordered by chunk index.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !uuidRe.test(id)) {
      return fail("Invalid document id.", 400);
    }
    const { limit, offset, page } = parsePagination(req);

    const pool = getPool();
    if (!(await documentExists(pool, ctx.org.id, id))) {
      return fail("Document not found.", 404);
    }

    const { chunks, total } = await listChunks(pool, ctx.org.id, id, {
      limit,
      offset,
    });

    return ok(chunks, { total, page, limit });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (typeof status === "number") {
      return fail((err as Error).message, status);
    }
    return fail("Failed to load document chunks.", 500);
  }
});
