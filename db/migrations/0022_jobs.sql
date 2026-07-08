-- Background jobs, queues & schedules. A DB-backed job queue plus cron-like
-- schedules, both fully org-scoped (multi-tenant). Idempotent: every statement
-- is guarded so re-running the migration runner is safe.
--
-- `jobs` is a durable work queue. Producers enqueue rows; a worker (driven by
-- POST /api/jobs/tick) atomically claims the next runnable job with
-- FOR UPDATE SKIP LOCKED, runs its registered handler, then marks it
-- completed/failed. `run_after` gates delayed jobs; `attempts` supports retry.
--
-- `schedules` are cron-like recurring triggers. Each due schedule enqueues a
-- job of its `type` with its `payload` when tick runs, then its next_run_at is
-- recomputed from the cron expression.

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The claim path: find the oldest runnable job for an org (status queued and
-- run_after in the past), ordered by run_after.
create index if not exists jobs_claim_idx
  on jobs(org_id, status, run_after);

-- Monitor/list path: newest first within an org, optionally filtered by status.
create index if not exists jobs_org_created_idx
  on jobs(org_id, created_at desc);

create table if not exists schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  type text not null,
  cron text not null,
  payload jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Due-schedule scan: enabled schedules whose next_run_at has passed, per org.
create index if not exists schedules_due_idx
  on schedules(org_id, enabled, next_run_at);

create index if not exists schedules_org_created_idx
  on schedules(org_id, created_at desc);
