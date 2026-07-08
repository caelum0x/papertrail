-- Public API platform: outbound webhooks + delivery log.
-- Lets an org subscribe to events (e.g. a completed verification) and have
-- PaperTrail POST a signed payload to their URL. Every delivery attempt is
-- recorded so the developer portal can show a delivery history.
-- Idempotent — safe to run repeatedly. Every table is org-scoped.

-- A webhook endpoint registered by an org. `events` is a jsonb array of event
-- names the endpoint subscribes to (e.g. ["verification.completed"]). `secret`
-- is used to HMAC-sign each delivery so the receiver can verify authenticity.
create table if not exists webhooks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  url text not null,
  events jsonb not null default '[]'::jsonb,
  secret text not null,
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  created_at timestamptz not null default now()
);

create index if not exists webhooks_org_id_idx on webhooks(org_id, created_at desc);

-- One row per delivery attempt. Records the HTTP response code (or null on a
-- network-level failure) and a coarse status so the portal can surface failures.
create table if not exists webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  webhook_id uuid not null references webhooks(id) on delete cascade,
  event text not null,
  status text not null
    check (status in ('success', 'failed', 'skipped')),
  response_code integer,
  created_at timestamptz not null default now()
);

create index if not exists webhook_deliveries_org_idx
  on webhook_deliveries(org_id, created_at desc);
create index if not exists webhook_deliveries_webhook_idx
  on webhook_deliveries(webhook_id, created_at desc);
