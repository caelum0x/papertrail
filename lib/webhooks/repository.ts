import type { Pool } from "pg";
import { secretHint } from "@/lib/webhooks/signing";
import type {
  WebhookSummary,
  WebhookDelivery,
  WebhookStatus,
  WebhookDeliveryStatus,
} from "@/lib/webhooks/types";

// Data access for webhooks + deliveries. Every query is org-scoped: the caller
// passes ctx.org.id and it is always part of the WHERE clause so one org can
// never read or mutate another org's rows. Parameterized queries throughout.

interface WebhookRow {
  id: string;
  url: string;
  events: unknown;
  secret: string;
  status: string;
  created_at: Date;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

function toSummary(row: WebhookRow): WebhookSummary {
  return {
    id: row.id,
    url: row.url,
    events: toStringArray(row.events),
    status: row.status as WebhookStatus,
    secretHint: row.secret ? secretHint(row.secret) : null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function countWebhooks(pool: Pool, orgId: string): Promise<number> {
  const { rows } = await pool.query(
    `select count(*)::int as n from webhooks where org_id = $1`,
    [orgId]
  );
  return rows[0]?.n ?? 0;
}

export async function listWebhooks(
  pool: Pool,
  orgId: string,
  limit: number,
  offset: number
): Promise<WebhookSummary[]> {
  const { rows } = await pool.query<WebhookRow>(
    `select id, url, events, secret, status, created_at
       from webhooks
      where org_id = $1
      order by created_at desc
      limit $2 offset $3`,
    [orgId, limit, offset]
  );
  return rows.map(toSummary);
}

export async function getWebhook(
  pool: Pool,
  orgId: string,
  id: string
): Promise<WebhookSummary | null> {
  const { rows } = await pool.query<WebhookRow>(
    `select id, url, events, secret, status, created_at
       from webhooks
      where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return rows[0] ? toSummary(rows[0]) : null;
}

// Returns the row WITH its secret, for internal use by dispatch/test only.
// Never expose this shape directly in an API response.
export async function getWebhookWithSecret(
  pool: Pool,
  orgId: string,
  id: string
): Promise<{ id: string; url: string; secret: string; status: string } | null> {
  const { rows } = await pool.query<WebhookRow>(
    `select id, url, secret, status from webhooks where org_id = $1 and id = $2`,
    [orgId, id]
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, url: row.url, secret: row.secret, status: row.status };
}

export interface InsertWebhookInput {
  orgId: string;
  url: string;
  events: string[];
  secret: string;
}

export async function insertWebhook(
  pool: Pool,
  input: InsertWebhookInput
): Promise<WebhookSummary> {
  const { rows } = await pool.query<WebhookRow>(
    `insert into webhooks (org_id, url, events, secret, status)
     values ($1, $2, $3::jsonb, $4, 'active')
     returning id, url, events, secret, status, created_at`,
    [input.orgId, input.url, JSON.stringify(input.events), input.secret]
  );
  return toSummary(rows[0]);
}

export interface UpdateWebhookFields {
  url?: string;
  events?: string[];
  status?: WebhookStatus;
}

// Immutable-style partial update: only provided fields are changed. Returns the
// updated summary, or null if the webhook doesn't exist in this org.
export async function updateWebhook(
  pool: Pool,
  orgId: string,
  id: string,
  fields: UpdateWebhookFields
): Promise<WebhookSummary | null> {
  const sets: string[] = [];
  const params: unknown[] = [orgId, id];
  let i = 3;

  if (fields.url !== undefined) {
    sets.push(`url = $${i++}`);
    params.push(fields.url);
  }
  if (fields.events !== undefined) {
    sets.push(`events = $${i++}::jsonb`);
    params.push(JSON.stringify(fields.events));
  }
  if (fields.status !== undefined) {
    sets.push(`status = $${i++}`);
    params.push(fields.status);
  }

  if (sets.length === 0) {
    return getWebhook(pool, orgId, id);
  }

  const { rows } = await pool.query<WebhookRow>(
    `update webhooks set ${sets.join(", ")}
      where org_id = $1 and id = $2
      returning id, url, events, secret, status, created_at`,
    params
  );
  return rows[0] ? toSummary(rows[0]) : null;
}

// Hard-deletes a webhook (deliveries cascade). Returns the deleted summary or
// null if it didn't exist in this org.
export async function deleteWebhook(
  pool: Pool,
  orgId: string,
  id: string
): Promise<WebhookSummary | null> {
  const { rows } = await pool.query<WebhookRow>(
    `delete from webhooks
      where org_id = $1 and id = $2
      returning id, url, events, secret, status, created_at`,
    [orgId, id]
  );
  return rows[0] ? toSummary(rows[0]) : null;
}

// Returns active webhooks in an org subscribed to a given event. Used by
// dispatch to fan an event out to the right endpoints.
export async function listActiveWebhooksForEvent(
  pool: Pool,
  orgId: string,
  event: string
): Promise<{ id: string; url: string; secret: string }[]> {
  const { rows } = await pool.query<WebhookRow>(
    `select id, url, secret
       from webhooks
      where org_id = $1
        and status = 'active'
        and events @> $2::jsonb`,
    [orgId, JSON.stringify([event])]
  );
  return rows.map((r) => ({ id: r.id, url: r.url, secret: r.secret }));
}

interface DeliveryRow {
  id: string;
  webhook_id: string;
  event: string;
  status: string;
  response_code: number | null;
  created_at: Date;
}

export interface RecordDeliveryInput {
  orgId: string;
  webhookId: string;
  event: string;
  status: WebhookDeliveryStatus;
  responseCode: number | null;
}

// Records one delivery attempt. Best-effort: never let a logging failure sink
// the dispatch it is recording.
export async function recordDelivery(
  pool: Pool,
  input: RecordDeliveryInput
): Promise<void> {
  try {
    await pool.query(
      `insert into webhook_deliveries
         (org_id, webhook_id, event, status, response_code)
       values ($1, $2, $3, $4, $5)`,
      [
        input.orgId,
        input.webhookId,
        input.event,
        input.status,
        input.responseCode,
      ]
    );
  } catch {
    // Delivery logging is best-effort and must not fail the dispatch.
  }
}

export async function countDeliveries(
  pool: Pool,
  orgId: string,
  webhookId: string
): Promise<number> {
  const { rows } = await pool.query(
    `select count(*)::int as n
       from webhook_deliveries
      where org_id = $1 and webhook_id = $2`,
    [orgId, webhookId]
  );
  return rows[0]?.n ?? 0;
}

export async function listDeliveries(
  pool: Pool,
  orgId: string,
  webhookId: string,
  limit: number,
  offset: number
): Promise<WebhookDelivery[]> {
  const { rows } = await pool.query<DeliveryRow>(
    `select id, webhook_id, event, status, response_code, created_at
       from webhook_deliveries
      where org_id = $1 and webhook_id = $2
      order by created_at desc
      limit $3 offset $4`,
    [orgId, webhookId, limit, offset]
  );
  return rows.map((r) => ({
    id: r.id,
    webhookId: r.webhook_id,
    event: r.event,
    status: r.status as WebhookDeliveryStatus,
    responseCode: r.response_code,
    createdAt: r.created_at.toISOString(),
  }));
}
