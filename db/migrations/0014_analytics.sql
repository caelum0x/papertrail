-- Analytics & evidence dashboards module. Persists user-defined dashboard
-- layouts (which KPI cards / charts to show, and how) so a team can save and
-- revisit custom views of their verification analytics. Multi-tenant: org_id on
-- every row. Idempotent — safe to run repeatedly.
--
-- config is a free-form jsonb blob describing the dashboard layout (card list,
-- filters, ordering). It is validated against a Zod schema at the API boundary,
-- so the column stays permissive here to avoid coupling storage to UI iteration.

create table if not exists saved_dashboards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists saved_dashboards_org_id_idx
  on saved_dashboards(org_id, created_at desc);
