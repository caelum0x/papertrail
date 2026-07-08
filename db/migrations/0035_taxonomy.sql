-- Tags & taxonomy. A single org-scoped tag vocabulary that can form a hierarchy
-- (parent_id -> tags.id) and be attached to arbitrary entities via taggings.
-- taggings are polymorphic: (entity_type, entity_id) points at any module's row,
-- so tags are reusable across claims, references, documents, projects, etc.
-- Idempotent: safe to run repeatedly.

create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  color text not null default '#64748b',
  parent_id uuid references tags(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists tags_org_id_idx
  on tags(org_id, created_at desc);
create index if not exists tags_parent_id_idx
  on tags(parent_id);

-- One tag name per org (case-insensitive) so the vocabulary stays clean and the
-- UI never shows duplicate labels. Partial-free unique index over lower(name).
create unique index if not exists tags_org_name_uniq
  on tags(org_id, lower(name));

create table if not exists taggings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists taggings_org_id_idx
  on taggings(org_id, created_at desc);
create index if not exists taggings_tag_id_idx
  on taggings(tag_id);
create index if not exists taggings_entity_idx
  on taggings(org_id, entity_type, entity_id);

-- A tag can only be attached to a given entity once.
create unique index if not exists taggings_uniq
  on taggings(org_id, tag_id, entity_type, entity_id);
