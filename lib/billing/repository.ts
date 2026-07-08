import type { Pool } from "pg";
import type {
  Plan,
  PlanLimits,
  Subscription,
  SubscriptionStatus,
  Invoice,
  InvoiceStatus,
} from "@/lib/billing/types";

// Data access for the billing module. Org-scoped functions take the resolved
// ctx.org.id (never a client-supplied org id) and filter by org_id. `plans` is
// a global catalog, so plan lookups are not org-scoped.

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

interface PlanRow {
  id: string;
  key: string;
  name: string;
  limits: PlanLimits | null;
  price_cents: number;
}

function toPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    limits: row.limits ?? {},
    priceCents: row.price_cents,
  };
}

export async function listPlans(pool: Pool): Promise<Plan[]> {
  const { rows } = await pool.query(
    `select id, key, name, limits, price_cents
       from plans
      order by price_cents asc`
  );
  return rows.map(toPlan);
}

export async function getPlanByKey(
  pool: Pool,
  key: string
): Promise<Plan | null> {
  const { rows } = await pool.query(
    `select id, key, name, limits, price_cents from plans where key = $1`,
    [key]
  );
  return rows.length ? toPlan(rows[0]) : null;
}

export async function getPlanById(
  pool: Pool,
  id: string
): Promise<Plan | null> {
  const { rows } = await pool.query(
    `select id, key, name, limits, price_cents from plans where id = $1`,
    [id]
  );
  return rows.length ? toPlan(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

interface SubscriptionRow {
  id: string;
  plan_id: string;
  plan_key: string;
  plan_name: string;
  price_cents: number;
  status: SubscriptionStatus;
  seats: number;
  current_period_end: Date | string | null;
  created_at: Date | string;
}

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    planId: row.plan_id,
    planKey: row.plan_key,
    planName: row.plan_name,
    priceCents: row.price_cents,
    status: row.status,
    seats: row.seats,
    currentPeriodEnd: row.current_period_end
      ? new Date(row.current_period_end).toISOString()
      : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

// The org's current (non-canceled) subscription joined with its plan, or null
// if the org has never subscribed.
export async function getActiveSubscription(
  pool: Pool,
  orgId: string
): Promise<Subscription | null> {
  const { rows } = await pool.query(
    `select s.id, s.plan_id, p.key as plan_key, p.name as plan_name,
            p.price_cents, s.status, s.seats, s.current_period_end, s.created_at
       from subscriptions s
       join plans p on p.id = s.plan_id
      where s.org_id = $1 and s.status <> 'canceled'
      order by s.created_at desc
      limit 1`,
    [orgId]
  );
  return rows.length ? toSubscription(rows[0]) : null;
}

export interface UpsertSubscriptionParams {
  orgId: string;
  planId: string;
  seats: number;
  status: SubscriptionStatus;
  currentPeriodEnd: string;
}

// Subscribes the org to a plan. Any existing live subscription is canceled first
// (the partial unique index allows only one non-canceled row per org), then a
// fresh row is inserted — this keeps a full history of past subscriptions.
// Runs in a transaction so the org is never left with zero or two live rows.
export async function upsertSubscription(
  pool: Pool,
  params: UpsertSubscriptionParams
): Promise<Subscription> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `update subscriptions set status = 'canceled'
        where org_id = $1 and status <> 'canceled'`,
      [params.orgId]
    );
    const { rows } = await client.query(
      `insert into subscriptions
         (org_id, plan_id, status, seats, current_period_end)
       values ($1, $2, $3, $4, $5)
       returning id, plan_id, status, seats, current_period_end, created_at`,
      [
        params.orgId,
        params.planId,
        params.status,
        params.seats,
        params.currentPeriodEnd,
      ]
    );
    await client.query("commit");
    const planRes = await client.query(
      `select key, name, price_cents from plans where id = $1`,
      [params.planId]
    );
    const plan = planRes.rows[0];
    return toSubscription({
      ...rows[0],
      plan_key: plan?.key ?? "",
      plan_name: plan?.name ?? "",
      price_cents: plan?.price_cents ?? 0,
    });
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Usage events
// ---------------------------------------------------------------------------

// Inserts a metered usage event. quantity defaults to 1 at the call site.
export async function insertUsageEvent(
  pool: Pool,
  params: {
    orgId: string;
    kind: string;
    quantity: number;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await pool.query(
    `insert into usage_events (org_id, kind, quantity, metadata)
       values ($1, $2, $3, $4)`,
    [
      params.orgId,
      params.kind,
      params.quantity,
      JSON.stringify(params.metadata ?? {}),
    ]
  );
}

// Sums consumed quantity for a kind since `since` (the current period start).
export async function sumUsageSince(
  pool: Pool,
  orgId: string,
  kind: string,
  since: Date
): Promise<number> {
  const { rows } = await pool.query(
    `select coalesce(sum(quantity), 0)::int as used
       from usage_events
      where org_id = $1 and kind = $2 and created_at >= $3`,
    [orgId, kind, since.toISOString()]
  );
  return rows[0]?.used ?? 0;
}

// Sums consumed quantity per kind since `since`, for the usage dashboard.
export async function sumUsageByKindSince(
  pool: Pool,
  orgId: string,
  since: Date
): Promise<Record<string, number>> {
  const { rows } = await pool.query(
    `select kind, coalesce(sum(quantity), 0)::int as used
       from usage_events
      where org_id = $1 and created_at >= $2
      group by kind`,
    [orgId, since.toISOString()]
  );
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[r.kind as string] = r.used as number;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

interface InvoiceRow {
  id: string;
  amount_cents: number;
  status: InvoiceStatus;
  period_start: Date | string;
  period_end: Date | string;
  created_at: Date | string;
}

function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    amountCents: row.amount_cents,
    status: row.status,
    periodStart: new Date(row.period_start).toISOString(),
    periodEnd: new Date(row.period_end).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function countInvoices(
  pool: Pool,
  orgId: string
): Promise<number> {
  const { rows } = await pool.query(
    `select count(*)::int as total from invoices where org_id = $1`,
    [orgId]
  );
  return rows[0]?.total ?? 0;
}

export async function listInvoices(
  pool: Pool,
  orgId: string,
  limit: number,
  offset: number
): Promise<Invoice[]> {
  const { rows } = await pool.query(
    `select id, amount_cents, status, period_start, period_end, created_at
       from invoices
      where org_id = $1
      order by created_at desc
      limit $2 offset $3`,
    [orgId, limit, offset]
  );
  return rows.map(toInvoice);
}
