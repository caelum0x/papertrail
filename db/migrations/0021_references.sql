-- Reference manager: a citation library (like Zotero/EndNote) scoped per org and
-- optionally per project. reference_libraries group individual references; each
-- reference stores structured bibliographic fields plus the raw parsed record so
-- round-tripping BibTeX/RIS never loses data. Idempotent: safe to run repeatedly.

create table if not exists reference_libraries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists reference_libraries_org_id_idx
  on reference_libraries(org_id, created_at desc);
create index if not exists reference_libraries_project_id_idx
  on reference_libraries(project_id);

create table if not exists "references" (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  library_id uuid not null references reference_libraries(id) on delete cascade,
  type text not null default 'article',
  title text,
  authors jsonb not null default '[]'::jsonb,
  year integer,
  journal text,
  doi text,
  pmid text,
  nct_id text,
  url text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists references_org_id_idx
  on "references"(org_id, created_at desc);
create index if not exists references_library_id_idx
  on "references"(library_id, created_at desc);

-- Trigram index so org-scoped title ILIKE search stays index-assisted.
create extension if not exists pg_trgm;
create index if not exists references_title_trgm_idx
  on "references" using gin (title gin_trgm_ops);
