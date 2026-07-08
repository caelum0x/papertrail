import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { created, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import { runSync } from "@/lib/connectors/service";
import { idSchema, failFromError } from "../../_lib";

export const runtime = "nodejs";

// POST /api/connectors/[id]/sync — run a sync now. Records a completed sync row
// (with item count + status) and an inbound event. Editor+.
export const POST = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");

    const parsed = idSchema.safeParse(params?.id);
    if (!parsed.success) {
      return fail("Invalid connector id.", 400);
    }

    const sync = await runSync(ctx.org.id, parsed.data);
    if (!sync) {
      return fail("Connector not found.", 404);
    }

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "connector.sync",
      entityType: "connector",
      entityId: parsed.data,
      metadata: { status: sync.status, items: sync.items },
    });

    return created(sync);
  } catch (err: unknown) {
    return failFromError(err, "Couldn't run the sync. Please try again.");
  }
});
