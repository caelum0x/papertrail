-- Reporting & exports module. Saved report definitions and export job history,
-- both multi-tenant (org_id on every row). Idempotent — safe to run repeatedly.
--
-- project_id on reports is a plain uuid (no FK) because the projects table is
-- owned by a sibling module; keeping it unconstrained avoids cross-module
-- migration ordering coupling. All queries still filter by org_id.

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid,
  name text not null,
  type text not null
    check (type in ('verifications', 'claims', 'evidence')),
  config jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists reports_org_id_idx on reports(org_id, created_at desc);
create index if not exists reports_project_id_idx on reports(org_id, project_id);
create index if not exists reports_type_idx on reports(org_id, type);

-- One row per export request. The generated document is returned inline in the
-- API response; result_url stays null unless a durable artifact store is added
-- later. status is terminal on creation (synchronous export) but the column is
-- kept for forward compatibility with async/queued exports.
create table if not exists export_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  type text not null
    check (type in ('verifications', 'claims', 'evidence')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'complete', 'failed')),
  result_url text,
  params jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists export_jobs_org_id_idx on export_jobs(org_id, created_at desc);
create index if not exists export_jobs_type_idx on export_jobs(org_id, type);
create index if not exists export_jobs_status_idx on export_jobs(org_id, status);
