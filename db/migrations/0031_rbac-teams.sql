-- Fine-grained RBAC & teams. Adds custom roles (named permission bundles),
-- teams (named groupings of members), team memberships, and explicit
-- permission grants that bind a subject (user/team/role) to a resource+action.
-- Every table is org-scoped and idempotent — safe to run repeatedly.

create extension if not exists pgcrypto;

-- Named bundles of permissions defined by an org, e.g. "Reviewer", "Analyst".
-- permissions is a jsonb array of "resource:action" strings.
create table if not exists custom_roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  permissions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create index if not exists custom_roles_org_id_idx on custom_roles(org_id);

-- A team is a named grouping of members within an org.
create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create index if not exists teams_org_id_idx on teams(org_id);

-- Membership of a user in a team. A user may belong to many teams.
create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (team_id, user_id)
);

create index if not exists team_members_org_id_idx on team_members(org_id);
create index if not exists team_members_team_id_idx on team_members(team_id);
create index if not exists team_members_user_id_idx on team_members(user_id);

-- An explicit grant binding a subject (a user, team, or custom role) to a
-- resource+action pair. subject_type in ('user','team','role').
create table if not exists permission_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  subject_type text not null check (subject_type in ('user', 'team', 'role')),
  subject_id uuid not null,
  resource text not null,
  action text not null,
  created_at timestamptz not null default now(),
  unique (org_id, subject_type, subject_id, resource, action)
);

create index if not exists permission_grants_org_id_idx on permission_grants(org_id);
create index if not exists permission_grants_subject_idx
  on permission_grants(org_id, subject_type, subject_id);
