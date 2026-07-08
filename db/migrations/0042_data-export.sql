-- Data export center. A data_export is one org-scoped, materialized export of a
-- single data domain (`scope` — claims / verifications / evidence / documents /
-- references) serialized to a `format` (csv / json). `params` jsonb records the
-- request (e.g. project narrowing) so the export is reproducible, `row_count`
-- caches how many rows the build produced, and `status` tracks the lifecycle so
-- the history view can render pending / complete / failed states without
-- recomputing. The generated document itself is rebuilt on demand by the
-- download route from the same scope/format/params, so no blob is stored here.
--
-- Every row carries org_id and cascades from orgs so one tenant can never read
-- or mutate another tenant's exports. Idempotent: safe to run repeatedly.

create table if not exists data_exports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  scope text not null
    check (scope in ('claims', 'verifications', 'evidence', 'documents', 'references')),
  format text not null default 'csv'
    check (format in ('csv', 'json')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'complete', 'failed')),
  row_count integer not null default 0,
  params jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- The common access path: list an org's exports newest-first.
create index if not exists data_exports_org_id_idx
  on data_exports(org_id, created_at desc);

-- Filter an org's history by scope (e.g. only claim exports).
create index if not exists data_exports_org_scope_idx
  on data_exports(org_id, scope, created_at desc);
