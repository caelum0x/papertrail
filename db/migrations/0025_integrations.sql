-- Integrations: connectors to external systems (Slack, email, Zotero, generic
-- webhooks, CSV import) plus an append-only log of every inbound/outbound event
-- that flowed through a connector. Both tables are org-scoped (org_id not null)
-- and always queried with ctx.org.id in the WHERE clause so one org can never
-- read or mutate another's connectors. Idempotent: every statement is guarded.
--
-- `integrations.config` holds the provider-specific, validated configuration as
-- jsonb (e.g. a Slack webhook URL, an email recipient, a Zotero collection).
-- `integration_events.payload` records the (redacted) body of a test or real
-- delivery so operators can see a connector's recent activity.

create table if not exists integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  provider text not null,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

-- Hot path: list an org's connectors newest-first.
create index if not exists integrations_org_created_idx
  on integrations(org_id, created_at desc);

-- Filter an org's connectors by provider (e.g. "do I already have Slack?").
create index if not exists integrations_org_provider_idx
  on integrations(org_id, provider);

create table if not exists integration_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  integration_id uuid not null references integrations(id) on delete cascade,
  direction text not null,
  event text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'success',
  created_at timestamptz not null default now()
);

-- Hot path: newest-first event feed for one connector within an org.
create index if not exists integration_events_org_integration_created_idx
  on integration_events(org_id, integration_id, created_at desc);
