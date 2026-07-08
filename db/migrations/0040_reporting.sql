-- Reporting engine. A report_definition is a saved, org-scoped report spec:
-- a `layout` jsonb describing which sections/widgets to render and a `filters`
-- jsonb constraining the data the run composes (e.g. status, date range). A
-- report_run is one materialized execution of a definition — its `result` jsonb
-- holds the composed, org-scoped data snapshot so the run detail view never has
-- to recompute. A scheduled_report attaches a cron + recipient list to a
-- definition so runs can be produced on a recurring basis.
--
-- Every table carries org_id and cascades from orgs so a tenant can never read
-- or mutate another tenant's rows. Idempotent: safe to run repeatedly.

create table if not exists report_definitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  type text not null default 'summary'
    check (type in ('summary', 'claims', 'reviews', 'documents')),
  layout jsonb not null default '{}'::jsonb,
  filters jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists report_definitions_org_id_idx
  on report_definitions(org_id, created_at desc);

create index if not exists report_definitions_org_type_idx
  on report_definitions(org_id, type, created_at desc);

-- A definition's name is unique within its org so the list stays unambiguous.
create unique index if not exists report_definitions_org_name_uniq
  on report_definitions(org_id, lower(name));

create table if not exists report_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  definition_id uuid not null references report_definitions(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'complete', 'failed')),
  result jsonb not null default '{}'::jsonb,
  format text not null default 'json'
    check (format in ('json', 'csv', 'html')),
  created_by uuid references users(id) on delete set null,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists report_runs_org_id_idx
  on report_runs(org_id, created_at desc);

-- The common access path: list an org's runs for one definition, newest first.
create index if not exists report_runs_definition_idx
  on report_runs(org_id, definition_id, created_at desc);

create table if not exists scheduled_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  definition_id uuid not null references report_definitions(id) on delete cascade,
  cron text not null,
  recipients jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists scheduled_reports_org_id_idx
  on scheduled_reports(org_id, created_at desc);

create index if not exists scheduled_reports_definition_idx
  on scheduled_reports(org_id, definition_id);

-- One active schedule per definition keeps recurrence unambiguous; a definition
-- may be rescheduled by updating the existing row rather than stacking crons.
create unique index if not exists scheduled_reports_definition_uniq
  on scheduled_reports(org_id, definition_id);
