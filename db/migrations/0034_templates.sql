-- Reusable templates for claims, reports, verifications, and documents.
-- A template is a named, categorized JSONB body an org can duplicate and apply
-- when creating the corresponding entity — e.g. a standard report layout or a
-- claim-intake field set. Org-scoped (multi-tenant) with uuid pks and created_at.
-- Idempotent — safe to run repeatedly.

create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  kind text not null,
  name text not null,
  description text,
  body jsonb not null default '{}'::jsonb,
  category text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists templates_org_id_idx on templates (org_id);
create index if not exists templates_org_kind_idx on templates (org_id, kind);
create index if not exists templates_org_category_idx on templates (org_id, category);
