-- Feature flags & experiments. Two related but distinct capabilities:
--   * feature_flags: boolean toggles with optional percentage rollout and
--     attribute rules, evaluated deterministically per subject (see
--     lib/flags/evaluate.ts). No randomness — the same (key, subject) always
--     resolves the same way so a user's experience is stable across requests.
--   * experiments: multi-variant A/B tests. Each variant carries a weight;
--     experiment_assignments records the sticky variant chosen for a subject so
--     they see a consistent variant for the life of the experiment.
-- Idempotent: safe to run repeatedly.

create table if not exists feature_flags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  key text not null,
  description text,
  enabled boolean not null default false,
  rollout_percent integer not null default 0,
  rules jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists feature_flags_org_id_idx
  on feature_flags(org_id, created_at desc);

-- Flag keys are unique per org so evaluate?key= resolves to exactly one flag.
create unique index if not exists feature_flags_org_key_uniq
  on feature_flags(org_id, lower(key));

create table if not exists experiments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  key text not null,
  name text not null,
  status text not null default 'draft',
  variants jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists experiments_org_id_idx
  on experiments(org_id, created_at desc);

create unique index if not exists experiments_org_key_uniq
  on experiments(org_id, lower(key));

create table if not exists experiment_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  experiment_id uuid not null references experiments(id) on delete cascade,
  subject_id text not null,
  variant text not null,
  created_at timestamptz not null default now()
);

create index if not exists experiment_assignments_experiment_idx
  on experiment_assignments(org_id, experiment_id, created_at desc);

-- A subject is assigned at most one variant per experiment (sticky assignment).
create unique index if not exists experiment_assignments_subject_uniq
  on experiment_assignments(org_id, experiment_id, subject_id);
