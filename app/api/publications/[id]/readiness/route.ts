import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { getPublication, getReadiness } from "../../lib/repository";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/publications/[id]/readiness — how many attached claims are verified &
// accurate, plus MLR sign-off status. Any member reads.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid publication id.", 400);
    }

    const pool = getPool();
    const publication = await getPublication(pool, ctx.org.id, id);
    if (!publication) {
      return fail("Publication not found.", 404);
    }

    const readiness = await getReadiness(pool, ctx.org.id, id);
    return ok(readiness);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to compute readiness.", 500);
  }
});
