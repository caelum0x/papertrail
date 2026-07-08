-- Saved views / searches / filters. A saved_view captures a named, reusable
-- query (filters + sort) for a given resource type (e.g. "claims", "references").
-- Views are owned by a user but may be `shared` so the whole org can pick them
-- from the SavedViewBar dropdown embedded in list pages.
-- The `query` jsonb holds an opaque, module-defined filter/sort payload; the API
-- layer validates its shape with zod before persisting.
-- Idempotent: safe to run repeatedly.

create table if not exists saved_views (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  resource text not null,
  query jsonb not null default '{}'::jsonb,
  shared boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists saved_views_org_id_idx
  on saved_views(org_id, created_at desc);

-- The common access path: list an org's views for one resource, newest first.
create index if not exists saved_views_org_resource_idx
  on saved_views(org_id, resource, created_at desc);

create index if not exists saved_views_user_id_idx
  on saved_views(user_id);

-- A user can't have two views with the same name for the same resource. Shared
-- views from other users may collide by name — that's fine; the constraint is
-- scoped to (org, owner, resource, name) so each owner keeps a clean namespace.
create unique index if not exists saved_views_owner_name_uniq
  on saved_views(org_id, user_id, resource, lower(name));
