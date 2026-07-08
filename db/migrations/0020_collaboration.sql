-- Collaboration: comments, annotations, and an org activity feed. All three
-- tables are multi-tenant (org_id not null) and always queried org-scoped.
--
-- comments    — threaded discussion attached to any entity (claim, document,
--               verification, review). parent_id enables one level of replies.
-- annotations — a highlighted quote + note anchored to a document page.
-- activity    — an append-only org feed of verbs performed on entities, used to
--               render the activity page and drive @mention surfacing.
--
-- Idempotent: every statement is guarded so this is safe to re-run.

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  parent_id uuid references comments(id) on delete cascade,
  author_id uuid not null references users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Hot path: load a thread for one entity, oldest-first within an org.
create index if not exists comments_org_entity_created_idx
  on comments(org_id, entity_type, entity_id, created_at asc);

-- Fetch replies to a given comment.
create index if not exists comments_parent_idx
  on comments(parent_id)
  where parent_id is not null;

create table if not exists annotations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  page_number integer not null,
  quote text not null,
  note text,
  author_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Hot path: load all annotations for a document, grouped by page.
create index if not exists annotations_org_document_idx
  on annotations(org_id, document_id, page_number);

create table if not exists activity (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  actor_id uuid references users(id) on delete set null,
  verb text not null,
  entity_type text not null,
  entity_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Hot path: the org feed, newest-first.
create index if not exists activity_org_created_idx
  on activity(org_id, created_at desc);

-- Filter the feed by entity or by actor.
create index if not exists activity_org_entity_idx
  on activity(org_id, entity_type, entity_id);
create index if not exists activity_org_actor_idx
  on activity(org_id, actor_id);
