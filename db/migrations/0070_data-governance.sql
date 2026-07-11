-- Data governance: legal holds (litigation / regulatory preservation).
-- A legal hold pins a data SUBJECT (identified by a stable string, e.g. an email)
-- so the retention-purge worker must NOT delete or anonymize their data while the
-- hold is active. Idempotent — safe to run repeatedly.

create table if not exists legal_holds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  subject text not null,
  reason text,
  active boolean not null default true,
  placed_by uuid,
  placed_at timestamptz default now(),
  released_at timestamptz
);

-- The retention worker consults this predicate with (org_id, active) as the hot
-- path, so index on exactly that pair.
create index if not exists legal_holds_org_active_idx
  on legal_holds(org_id, active);
