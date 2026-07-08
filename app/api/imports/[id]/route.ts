import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import {
  getBatch,
  listBatchRows,
  countBatchRows,
} from "@/lib/import/queries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/imports/[id] — a batch plus a paginated slice of its staged rows. Any
// member may read. Returns { batch, rows } as the data payload with meta for the
// rows pagination.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid import batch id.", 400);
    }

    const pool = getPool();
    const batch = await getBatch(pool, ctx.org.id, id);
    if (!batch) {
      return fail("Import batch not found.", 404);
    }

    const { limit, offset, page } = parsePagination(req);
    const [rows, total] = await Promise.all([
      listBatchRows(pool, ctx.org.id, id, limit, offset),
      countBatchRows(pool, ctx.org.id, id),
    ]);

    return ok({ batch, rows }, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load import batch.", 500);
  }
});
