import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { getRun } from "@/lib/trialMatcher/repository";

// GET /api/trial-matcher/[id] — one match run with its ranked trial matches, org-scoped.

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  requireRole(ctx, "viewer");

  const id = params?.id;
  if (!id || !UUID_RE.test(id)) {
    return fail("Invalid run id.", 400);
  }

  try {
    const detail = await getRun(getPool(), ctx.org.id, id);
    if (!detail) {
      return fail("Trial-match run not found.", 404);
    }
    return ok(detail);
  } catch (err) {
    console.error("[/api/trial-matcher/[id] GET] failed:", err);
    return fail("Failed to load trial-match run.", 500);
  }
});
