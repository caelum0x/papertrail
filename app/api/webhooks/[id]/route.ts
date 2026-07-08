import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { updateWebhookSchema } from "@/lib/webhooks/schemas";
import {
  getWebhook,
  updateWebhook,
  deleteWebhook,
  countDeliveries,
  listDeliveries,
} from "@/lib/webhooks/repository";
import type { WebhookSummary, WebhookDelivery } from "@/lib/webhooks/types";

export const runtime = "nodejs";

// GET /api/webhooks/[id] — one webhook plus a paginated slice of its recent
// delivery attempts. Admin+ only, org-scoped.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id) return fail("Webhook id is required.", 400);

    const pool = getPool();
    const webhook = await getWebhook(pool, ctx.org.id, id);
    if (!webhook) return fail("Webhook not found.", 404);

    const { limit, offset, page } = parsePagination(req);
    const [total, deliveries] = await Promise.all([
      countDeliveries(pool, ctx.org.id, id),
      listDeliveries(pool, ctx.org.id, id, limit, offset),
    ]);

    return ok<{ webhook: WebhookSummary; deliveries: WebhookDelivery[] }>(
      { webhook, deliveries },
      { total, page, limit }
    );
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load webhook.", 500);
  }
});

// PATCH /api/webhooks/[id] — update url / events / status. Admin+ only.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id) return fail("Webhook id is required.", 400);

    const json = await req.json().catch(() => null);
    const parsed = updateWebhookSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const events = parsed.data.events
      ? Array.from(new Set(parsed.data.events))
      : undefined;
    const updated = await updateWebhook(pool, ctx.org.id, id, {
      url: parsed.data.url,
      events,
      status: parsed.data.status,
    });
    if (!updated) return fail("Webhook not found.", 404);

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "webhook.update",
      entityType: "webhook",
      entityId: id,
      metadata: { url: updated.url, events: updated.events, status: updated.status },
    });

    return ok<WebhookSummary>(updated);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to update webhook.", 500);
  }
});

// DELETE /api/webhooks/[id] — remove a webhook (deliveries cascade). Admin+ only.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id) return fail("Webhook id is required.", 400);

    const pool = getPool();
    const deleted = await deleteWebhook(pool, ctx.org.id, id);
    if (!deleted) return fail("Webhook not found.", 404);

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "webhook.delete",
      entityType: "webhook",
      entityId: id,
      metadata: { url: deleted.url },
    });

    return ok<WebhookSummary>(deleted);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to delete webhook.", 500);
  }
});
