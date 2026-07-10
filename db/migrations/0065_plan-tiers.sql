-- Plan tiers & per-tier feature entitlements. Formalizes PaperTrail packaging
-- into three purchasable tiers — Researcher, Team, Pharma-Enterprise — on top of
-- the EXISTING plans + subscriptions + usage_events stack (migration 0015). This
-- migration does NOT invent a new billing system: it upserts three rows into the
-- global `plans` catalog and adds a `plan_features` table that gates capability
-- flags (SSO, SCIM, IP allow-listing, immutable audit export, Part-11 e-sign,
-- worker priority) by tier. checkQuota keeps enforcing the numeric `limits`;
-- plan_features enforces the boolean entitlements. Idempotent: safe to re-run.
--
-- `plans` has no org_id — it is shared reference data, not tenant data — so this
-- catalog is global. Entitlement checks resolve an org's plan via its active
-- subscription (see lib/billing/tiers.ts requireFeature) and are org-scoped there.

-- ---------------------------------------------------------------------------
-- Tier catalog. Upsert three canonical tiers. `limits` is the jsonb quota map
-- (kind -> monthly cap; -1 == unlimited) consumed by checkQuota. Keys are stable
-- machine identifiers; the pre-existing free/team/scale rows are left untouched
-- except `team`, which is re-pointed to the Team tier's canonical limits/price.
-- ---------------------------------------------------------------------------
insert into plans (key, name, limits, price_cents) values
  (
    'researcher',
    'Researcher',
    '{"verification": 100, "claim": 500, "document": 250}'::jsonb,
    0
  ),
  (
    'team',
    'Team',
    '{"verification": 2000, "claim": 20000, "document": 8000}'::jsonb,
    9900
  ),
  (
    'enterprise',
    'Pharma Enterprise',
    '{"verification": -1, "claim": -1, "document": -1}'::jsonb,
    250000
  )
on conflict (key) do update
  set name = excluded.name,
      limits = excluded.limits,
      price_cents = excluded.price_cents;

-- ---------------------------------------------------------------------------
-- Per-tier feature entitlements. One row per (plan, feature); `enabled` gates
-- the capability for every org subscribed to that plan. This table is the source
-- of truth for boolean entitlements — numeric quotas stay in plans.limits.
-- ---------------------------------------------------------------------------
create table if not exists plan_features (
  id uuid primary key default gen_random_uuid(),
  plan text not null,
  feature text not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);

-- Exactly one entitlement row per (plan, feature) so a lookup resolves to one
-- boolean and re-runs upsert cleanly.
create unique index if not exists plan_features_plan_feature_uniq
  on plan_features(lower(plan), lower(feature));

-- Hot path: resolve all entitlements for a plan at once.
create index if not exists plan_features_plan_idx
  on plan_features(lower(plan));

-- Seed the entitlement matrix. Enterprise-only capabilities (sso, scim,
-- ip_allowlist, audit_export, esign) are enabled ONLY for 'enterprise';
-- worker_priority is granted to Team and Enterprise. Researcher gets none of the
-- gated features. ON CONFLICT keeps this idempotent and lets us re-tune the
-- matrix without duplicating rows.
insert into plan_features (plan, feature, enabled) values
  -- Researcher: no gated enterprise features.
  ('researcher', 'sso',             false),
  ('researcher', 'scim',            false),
  ('researcher', 'ip_allowlist',    false),
  ('researcher', 'audit_export',    false),
  ('researcher', 'esign',           false),
  ('researcher', 'worker_priority', false),
  -- Team: priority workers, but enterprise governance features remain gated.
  ('team', 'sso',             false),
  ('team', 'scim',            false),
  ('team', 'ip_allowlist',    false),
  ('team', 'audit_export',    false),
  ('team', 'esign',           false),
  ('team', 'worker_priority', true),
  -- Pharma Enterprise: full entitlement set.
  ('enterprise', 'sso',             true),
  ('enterprise', 'scim',            true),
  ('enterprise', 'ip_allowlist',    true),
  ('enterprise', 'audit_export',    true),
  ('enterprise', 'esign',           true),
  ('enterprise', 'worker_priority', true)
on conflict (lower(plan), lower(feature)) do update
  set enabled = excluded.enabled;
