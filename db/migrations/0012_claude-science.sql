-- Claude Science integration: a literature-review / research workbench connector.
-- Researchers open a "science session" (a chat-style research thread scoped to an
-- optional project), exchange messages with a Claude-backed research assistant,
-- and store the workbench connection config for the Claude Science beta.
--
-- Multi-tenant: every table carries org_id and is filtered by ctx.org.id in the
-- data layer so a tenant can never read another tenant's rows. Idempotent: every
-- statement is guarded with "if not exists".

-- A research thread. project_id is optional so a session can be a scratch pad or
-- tied to a specific project workspace.
create table if not exists science_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  title text not null,
  status text not null default 'active'
    check (status in ('active', 'archived')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists science_sessions_org_idx
  on science_sessions(org_id, created_at desc);
create index if not exists science_sessions_project_idx
  on science_sessions(org_id, project_id);

-- A single turn in a session. `artifacts` holds structured research output from
-- the assistant (suggested literature queries, extracted citations, next steps).
create table if not exists science_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  session_id uuid not null references science_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  artifacts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists science_messages_session_idx
  on science_messages(org_id, session_id, created_at asc);

-- A configured connection to the Claude Science workbench beta. `config` stores
-- non-secret connection metadata (endpoint, workspace id, feature flags); the
-- API secret itself lives in an env var, never in this row.
create table if not exists science_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'disabled'
    check (status in ('disabled', 'enabled', 'error')),
  created_at timestamptz not null default now()
);

create index if not exists science_connections_org_idx
  on science_connections(org_id, created_at desc);
