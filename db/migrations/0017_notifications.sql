-- In-app notifications. Each notification targets one (org, user) recipient and
-- carries a type, human-readable title/body, and an optional deep link into the
-- console. read_at is null until the recipient marks it read. notification_prefs
-- holds a per-(org, user) jsonb map of type -> enabled so recipients can opt out
-- of categories. Idempotent: every statement is guarded.
--
-- Multi-tenant: both tables carry org_id (not null) and are always queried
-- org-scoped AND user-scoped (a member only ever sees their own notifications
-- within the active org).

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- Hot path for the feed & unread badge: newest-first per recipient within an org.
create index if not exists notifications_org_user_created_idx
  on notifications(org_id, user_id, created_at desc);

-- Partial index to count/list unread quickly.
create index if not exists notifications_org_user_unread_idx
  on notifications(org_id, user_id)
  where read_at is null;

-- Per-recipient delivery preferences. `prefs` is a jsonb map of notification
-- type -> boolean (true = deliver). A missing key defaults to enabled, so an
-- empty map means "receive everything".
create table if not exists notification_prefs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- One prefs row per recipient per org.
create unique index if not exists notification_prefs_org_user_idx
  on notification_prefs(org_id, user_id);
