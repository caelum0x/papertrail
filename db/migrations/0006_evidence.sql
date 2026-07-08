-- Evidence library: curated sources (PubMed, ClinicalTrials.gov, uploaded docs)
-- scoped to an org and optionally a project. Idempotent — safe to run repeatedly.

create table if not exists evidence_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid,
  source_type text not null
    check (source_type in ('pubmed', 'clinicaltrials', 'document', 'other')),
  external_id text,
  title text not null,
  url text,
  notes text,
  tags jsonb not null default '[]'::jsonb,
  added_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists evidence_items_org_id_idx
  on evidence_items(org_id, created_at desc);
create index if not exists evidence_items_project_id_idx
  on evidence_items(org_id, project_id);
create index if not exists evidence_items_source_type_idx
  on evidence_items(org_id, source_type);
