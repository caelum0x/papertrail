-- Enterprise foundation: multi-tenant orgs, users, memberships, invitations,
-- audit log, and API keys. Idempotent — safe to run repeatedly.

create extension if not exists pgcrypto;

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'viewer'
    check (role in ('owner', 'admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index if not exists memberships_user_id_idx on memberships(user_id);
create index if not exists memberships_org_id_idx on memberships(org_id);

create table if not exists invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  email text not null,
  role text not null default 'viewer'
    check (role in ('owner', 'admin', 'editor', 'viewer')),
  token text not null unique,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists invitations_org_id_idx on invitations(org_id);
create index if not exists invitations_email_idx on invitations(email);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_org_id_idx on audit_log(org_id, created_at desc);

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  key_hash text not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists api_keys_org_id_idx on api_keys(org_id);
