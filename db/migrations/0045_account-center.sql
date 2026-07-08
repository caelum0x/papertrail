-- Account center. Personal (per-user) account surfaces that are distinct from
-- org-level settings: the user's own personal access tokens and active login
-- sessions. Both are still org-scoped (a token / session is created while a user
-- is acting inside a given org) so a tenant can never enumerate another tenant's
-- rows, and every read is filtered by both org_id and user_id.
--
--   personal_tokens — long-lived personal access tokens a user mints for CLI /
--   script access. Only the token *hash* is stored (never the plaintext); the
--   plaintext is shown once at creation time and never again. last_used_at is
--   bumped opportunistically so the UI can surface stale tokens.
--
--   user_sessions — a record per active login session (device / browser) so the
--   security page can show "where you're signed in" and let the user revoke a
--   session remotely. user_agent / ip are captured best-effort for recognition.
--
-- Idempotent — safe to run repeatedly.

create table if not exists personal_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  token_hash text not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Hot path: list a user's tokens within an org, newest-first.
create index if not exists personal_tokens_org_user_idx
  on personal_tokens(org_id, user_id, created_at desc);

-- Token lookup by hash (on presentation) must never leak across tenants.
create index if not exists personal_tokens_hash_idx
  on personal_tokens(token_hash);

create table if not exists user_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  user_agent text,
  ip text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Hot path: a user's active sessions within an org, most-recently-seen first.
create index if not exists user_sessions_org_user_idx
  on user_sessions(org_id, user_id, last_seen_at desc);
