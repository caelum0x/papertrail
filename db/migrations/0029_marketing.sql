-- Marketing, docs & trust center.
-- The public marketing/docs/trust pages are static and require no schema. This
-- migration adds a small org-scoped feature_flags table so the product can gate
-- capabilities per tenant without a redeploy — it is not read by the public
-- trust-center pages (which expose no tenant data), only by the authed product.
-- Every table is org-scoped (multi-tenant) with uuid pks and created_at.
-- Idempotent — safe to run repeatedly.

create table if not exists feature_flags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  key text not null,
  enabled boolean not null default false,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);

create index if not exists feature_flags_org_id_idx on feature_flags (org_id);
