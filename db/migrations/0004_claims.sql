-- Claims management module. A claim is the core entity under verification,
-- scoped to an org and (optionally) a project. Idempotent — safe to re-run.

-- The claim under verification. org-scoped (multi-tenant); optional project link.
-- project_id is a plain uuid (no hard FK) so this migration does not depend on the
-- projects module's migration order; the app validates project ownership at write time.
create table if not exists claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid,
  text text not null,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'verifying', 'verified', 'flagged', 'archived')),
  cited_source_url text,
  submitted_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists claims_org_id_idx on claims(org_id, created_at desc);
create index if not exists claims_project_id_idx on claims(project_id);
create index if not exists claims_status_idx on claims(org_id, status);

-- Link the existing verification history to a claim. Nullable: pre-existing
-- verifications (created before claims existed) have no owning claim.
alter table verifications add column if not exists claim_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'verifications_claim_id_fkey'
  ) then
    alter table verifications
      add constraint verifications_claim_id_fkey
      foreign key (claim_id) references claims(id) on delete set null;
  end if;
end $$;

create index if not exists verifications_claim_id_idx on verifications(claim_id);
