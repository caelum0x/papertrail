-- Bulk import/export center. An import_batch captures one upload of CSV / BibTeX /
-- RIS text destined for a target table (claims | evidence | references), together
-- with the column mapping that projects parsed source rows onto the target's
-- fields. Each parsed record becomes an import_row (staged, not yet committed);
-- committing the batch inserts the mapped rows into the real target tables and
-- records per-row success/failure so a partial import is auditable.
-- Idempotent: safe to run repeatedly.

create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  target text not null
    check (target in ('claims', 'evidence', 'references')),
  format text not null
    check (format in ('csv', 'bibtex', 'ris')),
  status text not null default 'pending'
    check (status in ('pending', 'committing', 'committed', 'failed')),
  total integer not null default 0,
  succeeded integer not null default 0,
  failed integer not null default 0,
  mapping jsonb not null default '{}'::jsonb,
  error text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists import_batches_org_id_idx
  on import_batches(org_id, created_at desc);
create index if not exists import_batches_status_idx
  on import_batches(org_id, status);

create table if not exists import_rows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  batch_id uuid not null references import_batches(id) on delete cascade,
  row_index integer not null,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'skipped')),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists import_rows_batch_idx
  on import_rows(batch_id, row_index);
create index if not exists import_rows_org_id_idx
  on import_rows(org_id, created_at desc);
