-- Agent evaluation & quality. Labeled eval sets, versioned runs, and per-case
-- scores that productionize PaperTrail's eval concept: instead of eyeballing a
-- couple of demo claims, an org curates a labeled set (claim + expected
-- discrepancy_type + expected source substrings), runs the whole verification
-- pipeline over it, and gets accuracy + span-grounding metrics tracked over time.
--
-- All four tables are org-scoped (multi-tenant) with uuid pks and created_at.
-- Idempotent: every statement is guarded so re-running the migration runner is safe.

-- A named, labeled collection of eval cases owned by an org.
create table if not exists eval_sets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create index if not exists eval_sets_org_created_idx
  on eval_sets(org_id, created_at desc);

-- A single labeled example: a claim, the source it should match, the expected
-- discrepancy verdict, and substrings we expect to appear in the flagged source
-- spans (used to score span grounding). expected_substrings is a jsonb string[].
create table if not exists eval_cases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  eval_set_id uuid not null references eval_sets(id) on delete cascade,
  claim text not null,
  source_external_id text,
  expected_discrepancy_type text not null,
  expected_substrings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists eval_cases_set_idx
  on eval_cases(eval_set_id, created_at asc);

create index if not exists eval_cases_org_idx
  on eval_cases(org_id, created_at desc);

-- One execution of an eval set through the verification pipeline. summary is a
-- jsonb roll-up (per-discrepancy-type counts, dropped span totals, etc.).
create table if not exists eval_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  eval_set_id uuid not null references eval_sets(id) on delete cascade,
  status text not null default 'pending',
  accuracy double precision,
  span_grounding_rate double precision,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists eval_runs_set_created_idx
  on eval_runs(eval_set_id, created_at desc);

create index if not exists eval_runs_org_created_idx
  on eval_runs(org_id, created_at desc);

-- The scored outcome for a single case within a run. predicted is the jsonb
-- snapshot of what the pipeline produced (discrepancy_type, trust_score,
-- flagged span count, matched source, and the scoring breakdown).
create table if not exists eval_results (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  eval_run_id uuid not null references eval_runs(id) on delete cascade,
  case_id uuid not null references eval_cases(id) on delete cascade,
  predicted jsonb not null default '{}'::jsonb,
  passed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists eval_results_run_idx
  on eval_results(eval_run_id, created_at asc);

create index if not exists eval_results_org_idx
  on eval_results(org_id, created_at desc);
