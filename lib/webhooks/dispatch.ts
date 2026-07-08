import { getPool } from "@/lib/db";
import { logEvent } from "@/lib/logger";
import {
  signPayload,
  WEBHOOK_SIGNATURE_HEADER,
} from "@/lib/webhooks/signing";
import {
  listActiveWebhooksForEvent,
  recordDelivery,
} from "@/lib/webhooks/repository";
import type { DispatchResult } from "@/lib/webhooks/types";

// Outbound event dispatch. Given an org, an event name, and a payload, POST a
// signed JSON body to every active webhook in that org subscribed to the event,
// recording each attempt in webhook_deliveries. This is best-effort and fully
// isolated from the caller: a failing (or slow) receiver must never break the
// request that triggered the event, so all errors are caught and recorded, not
// thrown.

// Per-request timeout so a hung receiver can't block the triggering request.
const DELIVERY_TIMEOUT_MS = Number(
  process.env.WEBHOOK_TIMEOUT_MS || 5000
);

interface DispatchTarget {
  id: string;
  url: string;
  secret: string;
}

async function deliverOne(
  orgId: string,
  event: string,
  body: string,
  target: DispatchTarget
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  const pool = getPool();
  try {
    const res = await fetch(target.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "PaperTrail-Webhooks/1.0",
        [WEBHOOK_SIGNATURE_HEADER]: signPayload(target.secret, body),
        "X-PaperTrail-Event": event,
      },
      body,
      signal: controller.signal,
    });
    const ok2xx = res.status >= 200 && res.status < 300;
    await recordDelivery(pool, {
      orgId,
      webhookId: target.id,
      event,
      status: ok2xx ? "success" : "failed",
      responseCode: res.status,
    });
    return ok2xx;
  } catch (err) {
    // Network error / timeout / abort: no HTTP status to record.
    logEvent("webhook.delivery_error", {
      webhookId: target.id,
      event,
      error: String(err),
    });
    await recordDelivery(pool, {
      orgId,
      webhookId: target.id,
      event,
      status: "failed",
      responseCode: null,
    });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Dispatches an event to all matching active webhooks for an org. Returns a
// summary of how many endpoints were attempted and how many succeeded. Never
// throws — on any top-level failure it logs and returns a zeroed result.
export async function dispatchEvent(
  orgId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<DispatchResult> {
  const result: DispatchResult = {
    event,
    attempted: 0,
    delivered: 0,
    failed: 0,
  };

  try {
    const pool = getPool();
    const targets = await listActiveWebhooksForEvent(pool, orgId, event);
    if (targets.length === 0) {
      return result;
    }

    // Serialize once so every receiver gets an identical body and signature is
    // computed over exactly what is sent.
    const body = JSON.stringify({
      event,
      created_at: new Date().toISOString(),
      data: payload,
    });

    result.attempted = targets.length;

    const outcomes = await Promise.all(
      targets.map((t) => deliverOne(orgId, event, body, t))
    );
    for (const ok of outcomes) {
      if (ok) result.delivered += 1;
      else result.failed += 1;
    }

    logEvent("webhook.dispatch", {
      orgId,
      event,
      attempted: result.attempted,
      delivered: result.delivered,
      failed: result.failed,
    });
    return result;
  } catch (err) {
    logEvent("webhook.dispatch_error", { orgId, event, error: String(err) });
    return result;
  }
}

// Sends a single synthetic "ping" delivery to one target and records it. Used by
// the portal's "Send test" button. Returns the HTTP status code, or null on a
// network-level failure.
export async function sendTestDelivery(
  orgId: string,
  target: DispatchTarget
): Promise<{ ok: boolean; responseCode: number | null }> {
  const body = JSON.stringify({
    event: "ping",
    created_at: new Date().toISOString(),
    data: { message: "This is a test delivery from PaperTrail." },
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  const pool = getPool();
  try {
    const res = await fetch(target.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "PaperTrail-Webhooks/1.0",
        [WEBHOOK_SIGNATURE_HEADER]: signPayload(target.secret, body),
        "X-PaperTrail-Event": "ping",
      },
      body,
      signal: controller.signal,
    });
    const ok2xx = res.status >= 200 && res.status < 300;
    await recordDelivery(pool, {
      orgId,
      webhookId: target.id,
      event: "ping",
      status: ok2xx ? "success" : "failed",
      responseCode: res.status,
    });
    return { ok: ok2xx, responseCode: res.status };
  } catch (err) {
    logEvent("webhook.test_error", {
      webhookId: target.id,
      error: String(err),
    });
    await recordDelivery(pool, {
      orgId,
      webhookId: target.id,
      event: "ping",
      status: "failed",
      responseCode: null,
    });
    return { ok: false, responseCode: null };
  } finally {
    clearTimeout(timer);
  }
}
