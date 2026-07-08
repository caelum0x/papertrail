-- Platform observability module. Captures two lightweight signals that let an
-- operator see whether the platform is healthy without leaving the app:
--
--   system_metrics — a time-series of named numeric measurements (e.g.
--     "verify.latency_ms", "queue.depth"). One row per sample. The metrics API
--     buckets these into a series for charting.
--
--   error_events — application-level errors and warnings surfaced to operators
--     (distinct from the append-only audit_log, which records user actions).
--     `context` is a free-form jsonb blob; it is validated against a Zod schema
--     at the ingest boundary, so the column stays permissive here.
--
-- Multi-tenant: org_id on every row. Idempotent — safe to run repeatedly.

create table if not exists system_metrics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  metric text not null,
  value double precision not null,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists system_metrics_org_metric_idx
  on system_metrics(org_id, metric, recorded_at desc);

create index if not exists system_metrics_org_recorded_idx
  on system_metrics(org_id, recorded_at desc);

create table if not exists error_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  level text not null default 'error'
    check (level in ('debug', 'info', 'warn', 'error', 'fatal')),
  message text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists error_events_org_created_idx
  on error_events(org_id, created_at desc);

create index if not exists error_events_org_level_idx
  on error_events(org_id, level, created_at desc);
