import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { createWebhookSchema } from "@/lib/webhooks/schemas";
import { generateWebhookSecret, secretHint } from "@/lib/webhooks/signing";
import { countWebhooks, listWebhooks, insertWebhook } from "@/lib/webhooks/repository";
import type { WebhookSummary, WebhookCreated } from "@/lib/webhooks/types";

export const runtime = "nodejs";

// GET /api/webhooks — paginated list of the org's webhooks (never the full
// secret). Admin+ only, org-scoped.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const pool = getPool();
    const { limit, offset, page } = parsePagination(req);
    const [total, hooks] = await Promise.all([
      countWebhooks(pool, ctx.org.id),
      listWebhooks(pool, ctx.org.id, limit, offset),
    ]);
    return ok<WebhookSummary[]>(hooks, { total, page, limit });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load webhooks.", 500);
  }
});

// POST /api/webhooks — register a webhook. The signing secret is returned once
// in the response and never retrievable again. Admin+ only, org-scoped.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const json = await req.json().catch(() => null);
    const parsed = createWebhookSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const secret = generateWebhookSecret();
    // De-duplicate subscribed events.
    const events = Array.from(new Set(parsed.data.events));
    const summary = await insertWebhook(pool, {
      orgId: ctx.org.id,
      url: parsed.data.url,
      events,
      secret,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "webhook.create",
      entityType: "webhook",
      entityId: summary.id,
      // Never log the secret — only the non-sensitive url & events.
      metadata: { url: summary.url, events: summary.events },
    });

    const response: WebhookCreated = { ...summary, secret, secretHint: secretHint(secret) };
    return created<WebhookCreated>(response);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create webhook.", 500);
  }
});
