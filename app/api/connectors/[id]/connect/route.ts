import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import { connect } from "@/lib/connectors/service";
import { idSchema, failFromError } from "../../_lib";

export const runtime = "nodejs";

// POST /api/connectors/[id]/connect — verify + activate a connector. Flips its
// status to connected (or error when required config is missing) and logs a
// connect event. Editor+.
export const POST = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");

    const parsed = idSchema.safeParse(params?.id);
    if (!parsed.success) {
      return fail("Invalid connector id.", 400);
    }

    const result = await connect(ctx.org.id, parsed.data);
    if (!result) {
      return fail("Connector not found.", 404);
    }

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "connector.connect",
      entityType: "connector",
      entityId: parsed.data,
      metadata: { status: result.status },
    });

    return ok(result);
  } catch (err: unknown) {
    return failFromError(err, "Couldn't connect. Please try again.");
  }
});
