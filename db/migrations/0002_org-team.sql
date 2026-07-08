-- Organization & Team management. Uses foundation tables (orgs, users,
-- memberships, invitations, audit_log). Adds an org_settings table for
-- per-org configuration that doesn't belong on the orgs row itself.
-- Idempotent — safe to run repeatedly.

create table if not exists org_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references orgs(id) on delete cascade,
  default_member_role text not null default 'viewer'
    check (default_member_role in ('owner', 'admin', 'editor', 'viewer')),
  require_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists org_settings_org_id_idx on org_settings(org_id);

-- Track who invited whom so pending-invitation lists can show the inviter.
alter table invitations
  add column if not exists invited_by uuid references users(id) on delete set null;
