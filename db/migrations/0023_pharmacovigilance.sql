-- Pharmacovigilance & literature monitoring. Scheduled safety-literature
-- monitors that periodically query PubMed / ClinicalTrials.gov and record hits
-- for triage, plus a lightweight adverse-event (AE) signal board. Every table
-- is org-scoped (multi-tenant) with uuid pks and created_at. Idempotent — safe
-- to run repeatedly.

-- A saved, scheduled query over the safety literature. `sources` lists which
-- retrieval backends to search (e.g. ["pubmed","clinicaltrials"]). project_id is
-- a plain uuid (no hard FK) so this migration does not depend on the projects
-- module's order; the app validates project ownership at write time.
create table if not exists monitors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid,
  name text not null,
  query text not null,
  sources jsonb not null default '["pubmed","clinicaltrials"]'::jsonb,
  frequency text not null default 'weekly'
    check (frequency in ('daily', 'weekly', 'monthly')),
  enabled boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists monitors_org_id_idx on monitors(org_id, created_at desc);
create index if not exists monitors_project_id_idx on monitors(org_id, project_id);
create index if not exists monitors_enabled_idx on monitors(org_id, enabled);

-- One row per source surfaced by a monitor run. Deduped per monitor by the
-- (source_type, external_id) it points at so re-running a monitor doesn't create
-- duplicate hits. status tracks the triage lifecycle.
create table if not exists monitor_hits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  monitor_id uuid not null references monitors(id) on delete cascade,
  source_type text not null
    check (source_type in ('pubmed', 'clinicaltrials')),
  external_id text not null,
  title text,
  url text,
  matched_at timestamptz not null default now(),
  status text not null default 'new'
    check (status in ('new', 'relevant', 'dismissed', 'escalated')),
  created_at timestamptz not null default now(),
  unique (monitor_id, source_type, external_id)
);

create index if not exists monitor_hits_org_id_idx on monitor_hits(org_id, created_at desc);
create index if not exists monitor_hits_monitor_id_idx on monitor_hits(monitor_id, matched_at desc);
create index if not exists monitor_hits_status_idx on monitor_hits(org_id, status);

-- Adverse-event signal board: a triaged drug/event pair under review. Kept
-- deliberately simple (no hard link to hits) so signals can be raised manually
-- or escalated from a monitor hit.
create table if not exists ae_signals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  drug text not null,
  event text not null,
  severity text not null default 'moderate'
    check (severity in ('low', 'moderate', 'high', 'critical')),
  status text not null default 'open'
    check (status in ('open', 'investigating', 'confirmed', 'refuted', 'closed')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists ae_signals_org_id_idx on ae_signals(org_id, created_at desc);
create index if not exists ae_signals_status_idx on ae_signals(org_id, status);
create index if not exists ae_signals_severity_idx on ae_signals(org_id, severity);
