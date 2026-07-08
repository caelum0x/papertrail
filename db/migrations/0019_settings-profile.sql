-- User profiles & preferences. A user is global (one row in `users`), but their
-- profile and preferences are org-scoped: the same person can present a different
-- display name/title and keep different UI preferences per organization they belong
-- to. `prefs` is a free-form jsonb map (e.g. theme, density, default landing view,
-- onboarding progress) that the API validates against a Zod schema before writing.
-- Idempotent: every statement is guarded so re-running the runner is safe.
--
-- Multi-tenant: user_profiles carries org_id (not null) and is always queried
-- org-scoped AND user-scoped (a member only ever reads/writes their own profile
-- within the active org).

create table if not exists user_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  display_name text,
  title text,
  avatar_url text,
  prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- One profile row per user per org; also the lookup path used by GET/PATCH.
create unique index if not exists user_profiles_org_user_idx
  on user_profiles(org_id, user_id);
