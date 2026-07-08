import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getWebhookWithSecret } from "@/lib/webhooks/repository";
import { sendTestDelivery } from "@/lib/webhooks/dispatch";

export const runtime = "nodejs";

// POST /api/webhooks/[id]/test — send a synthetic "ping" delivery to the
// webhook's URL so a developer can confirm their receiver is wired up. Records
// the attempt in webhook_deliveries. Admin+ only, org-scoped.
export const POST = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id) return fail("Webhook id is required.", 400);

    const pool = getPool();
    const target = await getWebhookWithSecret(pool, ctx.org.id, id);
    if (!target) return fail("Webhook not found.", 404);

    const result = await sendTestDelivery(ctx.org.id, {
      id: target.id,
      url: target.url,
      secret: target.secret,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "webhook.test",
      entityType: "webhook",
      entityId: id,
      metadata: { responseCode: result.responseCode, ok: result.ok },
    });

    return ok<{ ok: boolean; responseCode: number | null }>(result);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to send test delivery.", 500);
  }
});
