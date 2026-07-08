-- Dashboard builder. A `dashboard` is an org-scoped, named canvas whose `layout`
-- jsonb captures grid/display preferences (columns, gap, theme). A dashboard owns
-- an ordered set of `dashboard_widgets`; each widget has a `kind` (which metric to
-- render), a `config` jsonb (the widget's own options — metric key, range, limit,
-- chart style) and a `position` jsonb (x/y/w/h grid placement). At data-resolution
-- time each widget's metric is computed strictly org-scoped so one tenant's
-- dashboard can never surface another tenant's numbers.
--
-- Note: this is distinct from the legacy `saved_dashboards` table (0014_analytics),
-- which stored a single flat config blob. The builder needs first-class widgets so
-- they can be added, reordered, configured, and resolved individually.
--
-- Every table carries org_id and cascades from orgs so a tenant can never read or
-- mutate another tenant's rows. Idempotent: safe to run repeatedly.

create table if not exists dashboards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  layout jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists dashboards_org_id_idx
  on dashboards(org_id, created_at desc);

-- A dashboard's name is unique within its org so the list stays unambiguous.
create unique index if not exists dashboards_org_name_uniq
  on dashboards(org_id, lower(name));

-- At most one default dashboard per org. Partial unique index lets many rows have
-- is_default = false while guaranteeing a single true.
create unique index if not exists dashboards_org_default_uniq
  on dashboards(org_id) where is_default;

create table if not exists dashboard_widgets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  dashboard_id uuid not null references dashboards(id) on delete cascade,
  kind text not null
    check (kind in ('metric', 'list', 'chart')),
  config jsonb not null default '{}'::jsonb,
  position jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- The common access path: fetch all widgets for one dashboard within an org.
create index if not exists dashboard_widgets_dashboard_idx
  on dashboard_widgets(org_id, dashboard_id, created_at asc);

create index if not exists dashboard_widgets_org_id_idx
  on dashboard_widgets(org_id, created_at desc);
