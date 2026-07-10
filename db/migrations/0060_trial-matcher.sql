-- CLINICAL TRIAL MATCHER — persisted match runs. A research coordinator pastes
-- de-identified patient notes; Claude extracts a structured, grounded patient profile;
-- we query ClinicalTrials.gov for candidate trials and assess EACH eligibility criterion
-- (met / not_met / unknown) against the profile, then rank trials by eligibility fit.
--
-- Governance constraint (enforced in lib/trialMatcher/*, mirrored here as documentation):
--   * NO patient identifiers are ever extracted or stored — no name, MRN, or DOB. The
--     `patient_summary` is a short non-identifying label only (e.g. the primary condition).
--   * The raw notes text is NEVER persisted; only `note_char_count` and the extracted,
--     de-identified `profile` (each field carrying a verbatim note span) are stored.
--
-- Idempotent — safe to run repeatedly. org_id on the run table; uuid pk; timestamptz
-- created_at. trial_matches inherit org scoping through their parent run (FK cascade).

create table if not exists trial_match_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_by uuid,
  patient_summary text,
  profile jsonb not null,
  note_char_count int,
  created_at timestamptz default now()
);

create index if not exists trial_match_runs_org_id_idx
  on trial_match_runs(org_id, created_at desc);

create table if not exists trial_matches (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references trial_match_runs(id) on delete cascade,
  nct_id text,
  title text,
  url text,
  phase text,
  overall_status text,
  eligibility_score numeric,
  verdict text,
  criteria jsonb not null,
  created_at timestamptz default now()
);

create index if not exists trial_matches_run_id_idx
  on trial_matches(run_id);
