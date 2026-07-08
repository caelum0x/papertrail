import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { getEvalRun, getEvalResults } from "@/lib/eval/queries";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/eval-runs/[id] — a run with its per-case pass/fail results (expected
// vs predicted). Any member (viewer+) may read.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid eval run id.", 400);
    }

    const pool = getPool();
    const run = await getEvalRun(pool, ctx.org.id, id);
    if (!run) {
      return fail("Eval run not found.", 404);
    }
    const results = await getEvalResults(pool, ctx.org.id, id);
    return ok({ run, results });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load eval run.", 500);
  }
});
