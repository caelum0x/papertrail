-- Announcements, releases & changelog. An org's admins publish announcements
-- (product news, maintenance notices, policy changes) and version releases (the
-- changelog). Members read them, and each member's read state is tracked so the
-- in-app banner can show only unread items.
--
-- announcements are drafted then published: published_at is null while a draft,
-- and set to now() when an admin publishes it. Only published announcements are
-- visible to non-admin members. releases are always visible once created.
--
-- Every table carries org_id and cascades from orgs so a tenant can never read
-- or mutate another tenant's rows. Idempotent: safe to run repeatedly.

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  title text not null,
  body text not null,
  kind text not null default 'general',
  audience text not null default 'all',
  published_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Primary access path: an org's announcements, newest first.
create index if not exists announcements_org_id_idx
  on announcements(org_id, created_at desc);

-- Published-only listing (the member-facing feed and banner) ordered by publish
-- time. Partial index keeps it small and skips drafts entirely.
create index if not exists announcements_org_published_idx
  on announcements(org_id, published_at desc)
  where published_at is not null;

create table if not exists releases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  version text not null,
  notes text not null default '',
  released_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Primary access path: an org's release timeline, newest release first.
create index if not exists releases_org_released_idx
  on releases(org_id, released_at desc);

-- One version string per org (the changelog can't have two "v1.2.0" entries).
create unique index if not exists releases_org_version_uniq
  on releases(org_id, lower(version));

create table if not exists announcement_reads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  announcement_id uuid not null references announcements(id) on delete cascade,
  read_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- One read row per (user, announcement); re-marking read is an idempotent upsert.
create unique index if not exists announcement_reads_uniq
  on announcement_reads(org_id, user_id, announcement_id);

-- Look up a user's read state fast when computing unread counts for the banner.
create index if not exists announcement_reads_user_idx
  on announcement_reads(org_id, user_id);
