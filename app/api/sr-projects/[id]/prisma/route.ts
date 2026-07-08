import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { getPrismaCounts, getSrProject } from "../../lib/repository";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/sr-projects/[id]/prisma — PRISMA flow-diagram counts. Any member reads.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid review id.", 400);
    }

    const pool = getPool();
    const project = await getSrProject(pool, ctx.org.id, id);
    if (!project) {
      return fail("Systematic review not found.", 404);
    }

    const counts = await getPrismaCounts(pool, ctx.org.id, id);
    return ok(counts);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to compute PRISMA counts.", 500);
  }
});
