import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import { testConnectorSchema } from "@/lib/connectors/schemas";
import { test } from "@/lib/connectors/service";
import { idSchema, failFromError } from "../../_lib";

export const runtime = "nodejs";

// POST /api/connectors/[id]/test — emit a lightweight test event through the
// connector (outbound) and record it so it appears in the event log. Editor+.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");

    const parsed = idSchema.safeParse(params?.id);
    if (!parsed.success) {
      return fail("Invalid connector id.", 400);
    }

    const body = await req.json().catch(() => ({}));
    const parsedBody = testConnectorSchema.safeParse(body ?? {});
    if (!parsedBody.success) {
      return fail(parsedBody.error.issues[0]?.message ?? "Invalid test.", 400);
    }

    const result = await test(ctx.org.id, parsed.data, parsedBody.data.event);
    if (!result) {
      return fail("Connector not found.", 404);
    }

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "connector.test",
      entityType: "connector",
      entityId: parsed.data,
      metadata: { event: result.event },
    });

    return ok({
      connectorId: parsed.data,
      status: result.connector.status,
      message: `Test event "${result.event}" sent.`,
    });
  } catch (err: unknown) {
    return failFromError(err, "Couldn't send the test event. Please try again.");
  }
});
