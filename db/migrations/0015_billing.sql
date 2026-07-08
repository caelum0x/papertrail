-- Billing, plans & usage metering. Every org has (at most one active)
-- subscription to a plan; usage_events meter consumption of quota-bearing kinds
-- (e.g. verifications, Claude tokens) so we can authorize spend BEFORE it happens.
-- invoices record billed periods. Idempotent: every statement guarded.
--
-- Multi-tenant: usage_events, subscriptions and invoices carry org_id (not null)
-- and are always queried org-scoped. `plans` is a global catalog (no org_id) —
-- it is shared reference data, not tenant data.

-- Global plan catalog. `limits` is a jsonb map of quota kind -> monthly cap
-- (e.g. {"verification": 100, "claim": 500}); a missing kind or -1 means
-- unlimited. `key` is the stable machine identifier used in code/config.
create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  limits jsonb not null default '{}'::jsonb,
  price_cents integer not null default 0 check (price_cents >= 0),
  created_at timestamptz not null default now()
);

-- Seed the baseline catalog. ON CONFLICT keeps re-runs idempotent and lets us
-- tune limits/prices without duplicating rows.
insert into plans (key, name, limits, price_cents) values
  ('free', 'Free', '{"verification": 25, "claim": 100, "document": 50}'::jsonb, 0),
  ('team', 'Team', '{"verification": 500, "claim": 5000, "document": 2000}'::jsonb, 4900),
  ('scale', 'Scale', '{"verification": -1, "claim": -1, "document": -1}'::jsonb, 24900)
on conflict (key) do update
  set name = excluded.name,
      limits = excluded.limits,
      price_cents = excluded.price_cents;

-- One row per org's current subscription. status tracks lifecycle; seats is the
-- billed seat count; current_period_end drives quota-window resets & renewal.
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  plan_id uuid not null references plans(id) on delete restrict,
  status text not null default 'active'
    check (status in ('active', 'trialing', 'past_due', 'canceled')),
  seats integer not null default 1 check (seats >= 1),
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

-- At most one live (non-canceled) subscription per org.
create unique index if not exists subscriptions_org_active_idx
  on subscriptions(org_id)
  where status <> 'canceled';

-- Metered consumption. One row per quota-bearing action; quantity is usually 1
-- but tokens/bulk ops can record more. checkQuota sums quantity in the current
-- period window and compares against the plan limit for `kind`.
create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  kind text not null,
  quantity integer not null default 1 check (quantity >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Hot path for checkQuota: sum by org + kind over a time window.
create index if not exists usage_events_org_kind_created_idx
  on usage_events(org_id, kind, created_at desc);

-- Billed periods. amount_cents is the total for [period_start, period_end).
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  amount_cents integer not null default 0 check (amount_cents >= 0),
  status text not null default 'open'
    check (status in ('open', 'paid', 'void', 'uncollectible')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists invoices_org_created_idx
  on invoices(org_id, created_at desc);
