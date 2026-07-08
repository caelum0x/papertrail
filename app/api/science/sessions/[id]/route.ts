import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getSession, listMessages } from "@/lib/science/queries";
import { getWorkbenchStatus } from "@/lib/science/client";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/science/sessions/[id] — session detail with its message history and
// the current workbench-connection status. Any member may read.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid session id.", 400);
    }

    const pool = getPool();
    const session = await getSession(pool, ctx.org.id, id);
    if (!session) {
      return fail("Research session not found.", 404);
    }

    const messages = await listMessages(pool, ctx.org.id, id);
    const status = getWorkbenchStatus();

    return ok({
      session,
      messages,
      workbench: {
        configured: status.configured,
        endpoint: status.endpoint,
        reason: status.reason,
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load research session.", 500);
  }
});
