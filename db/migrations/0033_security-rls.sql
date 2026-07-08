-- Security & data isolation. Models the org-facing security posture and the
-- database-level tenant isolation that backs it:
--   * security_policies — per-org toggles/config for security controls
--                         (e.g. require_ip_allowlist, session timeouts,
--                         mfa requirements). config is opaque jsonb per kind.
--   * ip_allowlist      — CIDR ranges permitted to reach the org's data. An
--                         empty allowlist means "no IP restriction".
--   * Row-Level Security — enables Postgres RLS on the core tenant tables and
--                         installs an org-scoping policy keyed off the
--                         `app.current_org_id` GUC. Application code still
--                         filters by org_id (defense in depth); RLS is the
--                         backstop that prevents a missing WHERE clause from
--                         leaking cross-tenant rows.
-- Every module table is org-scoped (multi-tenant) with uuid pks and created_at.
-- Idempotent — safe to run repeatedly (guarded creates + DO blocks for policies).

-- Per-org security policy. `kind` names the control; `config` holds its opaque
-- settings (shape validated in lib/security/schemas.ts, not the DB). One row per
-- (org, kind) so a policy can be toggled/updated in place. `enabled` lets a
-- policy be provisioned but paused without losing its config.
create table if not exists security_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  kind text not null,
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, kind)
);

create index if not exists security_policies_org_id_idx
  on security_policies(org_id, created_at desc);

-- IP allowlist entries. Each row is a CIDR range (stored as text; validated as
-- IPv4/IPv6 CIDR in lib/security/schemas.ts) that may reach this org's data,
-- with an optional human note. No unique constraint on cidr so the same range
-- can be re-added with a different note history, but the app dedupes on write.
create table if not exists ip_allowlist (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  cidr text not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists ip_allowlist_org_id_idx
  on ip_allowlist(org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row-Level Security on core tenant tables.
--
-- Strategy: each policy restricts visible rows to those whose org_id matches the
-- `app.current_org_id` session GUC. When the GUC is unset/empty (e.g. migrations,
-- admin maintenance, or the pooled app role before it sets the GUC), the policy
-- evaluates permissively so existing application queries — which already filter
-- by org_id explicitly — keep working. This makes enabling RLS non-breaking while
-- still providing a hard backstop once the GUC is set per-request.
--
-- `current_setting('app.current_org_id', true)` returns NULL instead of raising
-- when the GUC is undefined, which keeps this safe to enable everywhere.
--
-- All statements are guarded so re-running the migration is a no-op:
--   * enable RLS is idempotent by nature.
--   * create policy has no IF NOT EXISTS in Postgres, so we drop-then-create
--     inside a DO block that first checks pg_policies.
-- ---------------------------------------------------------------------------

do $$
declare
  tenant_table text;
  tenant_tables text[] := array[
    'claims',
    'documents',
    'evidence_items',
    'reports',
    'reviews',
    'projects',
    'notifications',
    'security_policies',
    'ip_allowlist'
  ];
  policy_name text := 'org_isolation';
begin
  foreach tenant_table in array tenant_tables loop
    -- Only touch tables that actually exist in this database.
    if exists (
      select 1
        from information_schema.tables
       where table_schema = 'public'
         and table_name = tenant_table
    ) then
      -- Enable RLS (idempotent).
      execute format('alter table public.%I enable row level security', tenant_table);

      -- Recreate the isolation policy idempotently: drop if present, then create.
      if exists (
        select 1
          from pg_policies
         where schemaname = 'public'
           and tablename = tenant_table
           and policyname = policy_name
      ) then
        execute format('drop policy %I on public.%I', policy_name, tenant_table);
      end if;

      -- USING controls read/update/delete visibility; WITH CHECK controls inserts.
      -- Permissive when the GUC is unset (NULL) so app queries and migrations keep
      -- working; strict org match when the GUC is present.
      execute format(
        'create policy %I on public.%I '
        || 'using ('
        || '  current_setting(''app.current_org_id'', true) is null '
        || '  or current_setting(''app.current_org_id'', true) = '''' '
        || '  or org_id::text = current_setting(''app.current_org_id'', true)'
        || ') '
        || 'with check ('
        || '  current_setting(''app.current_org_id'', true) is null '
        || '  or current_setting(''app.current_org_id'', true) = '''' '
        || '  or org_id::text = current_setting(''app.current_org_id'', true)'
        || ')',
        policy_name, tenant_table
      );
    end if;
  end loop;
end
$$;
