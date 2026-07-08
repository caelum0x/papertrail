-- API usage analytics. Every request served by the public API (see the api_keys
-- table from 0001) is recorded in api_requests so an org can see traffic volume,
-- latency, error rate, and per-route / per-key breakdowns without depending on an
-- external observability vendor. rate_limit_events records each time a request was
-- throttled, so the org can spot keys or routes that are hitting limits.
--
-- Both tables carry org_id and cascade from orgs so a tenant can never read or
-- mutate another tenant's telemetry. api_key_id is nullable and cascades to null
-- so deleting a key preserves the historical usage rows (the key is just unlinked).
-- Idempotent: safe to run repeatedly.

create table if not exists api_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  api_key_id uuid references api_keys(id) on delete set null,
  route text not null,
  method text not null,
  status_code integer not null,
  duration_ms integer not null default 0,
  created_at timestamptz not null default now()
);

-- Primary access path: an org's requests, newest first (the request log).
create index if not exists api_requests_org_id_idx
  on api_requests(org_id, created_at desc);

-- Per-route rollups and route filtering on the log.
create index if not exists api_requests_org_route_idx
  on api_requests(org_id, route, created_at desc);

-- Per-key rollups and key filtering on the log.
create index if not exists api_requests_org_key_idx
  on api_requests(org_id, api_key_id, created_at desc);

-- Error-rate rollups: partial index over non-2xx responses.
create index if not exists api_requests_org_errors_idx
  on api_requests(org_id, created_at desc)
  where status_code >= 400;

create table if not exists rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  api_key_id uuid references api_keys(id) on delete set null,
  route text not null,
  created_at timestamptz not null default now()
);

-- Primary access path: an org's throttle events, newest first.
create index if not exists rate_limit_events_org_id_idx
  on rate_limit_events(org_id, created_at desc);

-- Per-route rollups of throttling.
create index if not exists rate_limit_events_org_route_idx
  on rate_limit_events(org_id, route, created_at desc);
