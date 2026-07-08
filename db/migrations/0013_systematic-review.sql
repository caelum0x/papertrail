-- Systematic review & screening (PRISMA-style). Distinct from the QA 'reviews'
-- module: this models literature screening for evidence synthesis. A project
-- poses a research question with inclusion criteria; candidate records are
-- imported (from PubMed / ClinicalTrials.gov / manual), then screened through
-- title/abstract and full-text stages with include/exclude decisions.
--
-- Multi-tenant: org_id on every row. Idempotent — safe to run repeatedly.
-- project_id is a plain uuid (no hard FK) so this migration does not depend on
-- the projects module's migration order; the app validates ownership by org_id.

create table if not exists sr_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid,
  name text not null,
  question text not null,
  inclusion_criteria jsonb not null default '[]'::jsonb,
  status text not null default 'active'
    check (status in ('active', 'completed', 'archived')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sr_projects_org_id_idx on sr_projects(org_id, created_at desc);
create index if not exists sr_projects_project_id_idx on sr_projects(project_id);
create index if not exists sr_projects_status_idx on sr_projects(org_id, status);

-- A candidate record imported into a review. status tracks the current screening
-- position across stages. external_id + source_type identify the upstream record
-- (e.g. a PubMed PMID or an NCT number) so duplicates can be detected.
create table if not exists sr_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  sr_project_id uuid not null references sr_projects(id) on delete cascade,
  source_type text not null default 'manual'
    check (source_type in ('pubmed', 'clinicaltrials', 'manual', 'other')),
  external_id text,
  title text not null,
  abstract text,
  status text not null default 'pending'
    check (status in (
      'pending',
      'title_included',
      'title_excluded',
      'fulltext_included',
      'fulltext_excluded'
    )),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sr_records_project_idx
  on sr_records(org_id, sr_project_id, created_at desc);
create index if not exists sr_records_status_idx
  on sr_records(org_id, sr_project_id, status);
-- Duplicate detection within a review by upstream identity (partial: only when
-- an external id is present).
create unique index if not exists sr_records_external_uniq
  on sr_records(sr_project_id, source_type, external_id)
  where external_id is not null;

-- An append-only log of screening decisions. Every include/exclude at every
-- stage is recorded (with an optional reason) so the PRISMA flow numbers and the
-- exclusion-reason breakdown are fully auditable. The current sr_records.status
-- reflects the latest decision.
create table if not exists screening_decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  sr_record_id uuid not null references sr_records(id) on delete cascade,
  reviewer_id uuid references users(id) on delete set null,
  stage text not null
    check (stage in ('title_abstract', 'full_text')),
  decision text not null
    check (decision in ('include', 'exclude')),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists screening_decisions_record_idx
  on screening_decisions(org_id, sr_record_id, created_at desc);
create index if not exists screening_decisions_stage_idx
  on screening_decisions(org_id, stage, decision);
