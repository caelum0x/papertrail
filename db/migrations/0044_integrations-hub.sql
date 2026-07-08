-- Integrations hub (expanded connectors). This module supersedes the minimal
-- 0025 integrations table with a richer model: `connectors` are the configured
-- provider instances (Slack, MS Teams, email, Zotero, ORCID, Crossref, S3,
-- generic webhook), `connector_syncs` records each sync run (how many items were
-- pulled/pushed and its outcome), and `connector_events` is an append-only log of
-- every inbound/outbound event that flowed through a connector.
--
-- Every table is org-scoped (org_id not null, cascades from orgs) and is always
-- queried with ctx.org.id in the WHERE clause so one org can never read or mutate
-- another's connectors, syncs, or events. All statements are idempotent.
--
-- `connectors.config` holds the provider-specific, Zod-validated configuration as
-- jsonb (e.g. a Slack webhook URL, an S3 bucket/region, an ORCID id). Secrets are
-- redacted before being written to `connector_events.payload`.

create table if not exists connectors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  provider text not null,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'disconnected',
  created_at timestamptz not null default now()
);

-- Hot path: list an org's connectors newest-first.
create index if not exists connectors_org_created_idx
  on connectors(org_id, created_at desc);

-- Filter an org's connectors by provider (e.g. "do I already have Slack?").
create index if not exists connectors_org_provider_idx
  on connectors(org_id, provider);

create table if not exists connector_syncs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  connector_id uuid not null references connectors(id) on delete cascade,
  status text not null default 'running',
  items integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

-- Hot path: newest-first sync history for one connector within an org.
create index if not exists connector_syncs_org_connector_created_idx
  on connector_syncs(org_id, connector_id, created_at desc);

create table if not exists connector_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  connector_id uuid not null references connectors(id) on delete cascade,
  direction text not null,
  event text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Hot path: newest-first event feed for one connector within an org.
create index if not exists connector_events_org_connector_created_idx
  on connector_events(org_id, connector_id, created_at desc);
