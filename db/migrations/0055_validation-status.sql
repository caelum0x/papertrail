-- VALIDATION / COMPLIANCE STATUS framework. A per-evidence-run record of which
-- verification engines ran, which primary sources were reachable, the resulting
-- coverage, and a documented deterministic quality score. This lets a submission
-- carry its own validation report: a regulated-pharma buyer (medical-affairs /
-- regulatory) can show, for any evidence run, exactly what was checked, what was
-- reachable, and how complete the run was — an auditable "was this defensible?"
-- artifact rather than an opaque verdict.
--
--   * subject            — the claim / submission the run validates (denormalized)
--   * engines_run        — jsonb list of engine keys that actually executed
--   * sources_reachable  — jsonb map/list of source -> reachable boolean
--   * coverage           — ran/required engines, in [0,1]
--   * quality_score      — documented weighting of coverage + source reachability
--   * status             — complete | partial | insufficient
--
-- Idempotent: safe to run repeatedly. org_id on the table (uuid FK); uuid pk;
-- created_at timestamptz default now(); index (org_id, created_at desc).

create table if not exists validation_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  subject text not null,
  engines_run jsonb not null default '[]'::jsonb,
  sources_reachable jsonb not null default '{}'::jsonb,
  coverage numeric not null default 0,
  quality_score numeric not null default 0,
  status text not null,
  created_at timestamptz not null default now()
);

create index if not exists validation_runs_org_id_idx
  on validation_runs(org_id, created_at desc);
