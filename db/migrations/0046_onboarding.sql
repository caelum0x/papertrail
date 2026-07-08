-- Onboarding & workspace setup. Tracks per-user, per-org progress through the
-- setup wizard so a returning user resumes where they left off and admins can see
-- who has finished onboarding. `steps` is a jsonb map of stepId -> completed-at
-- ISO timestamp (or `true`), so adding a new wizard step never needs a migration.
-- `completed` is a denormalized flag flipped when the final step is done, letting
-- the console cheaply decide whether to nudge the user into the wizard.
--
-- Every row carries org_id and cascades from orgs so a tenant can never read or
-- mutate another tenant's onboarding progress; one row per (org_id, user_id).
-- Idempotent: safe to run repeatedly.

create table if not exists onboarding_state (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  steps jsonb not null default '{}'::jsonb,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

-- One onboarding record per user within an org. Upserts key on this pair.
create unique index if not exists onboarding_state_org_user_uniq
  on onboarding_state(org_id, user_id);

-- Primary access path: an org's onboarding rows (admin visibility), newest first.
create index if not exists onboarding_state_org_id_idx
  on onboarding_state(org_id, created_at desc);
