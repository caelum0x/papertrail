-- Review workflows: assign verifications/claims for human review & approval.
-- Multi-tenant (org_id on every row). Idempotent — safe to run repeatedly.
--
-- project_id and claim_id are plain uuids (no FK) because those tables are
-- owned by sibling modules; keeping them unconstrained avoids cross-module
-- migration ordering coupling. All queries still filter by org_id.

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid,
  claim_id uuid,
  assignee_id uuid references users(id) on delete set null,
  reviewer_id uuid references users(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'in_review', 'approved', 'rejected', 'cancelled')),
  decision text
    check (decision is null or decision in ('approved', 'rejected')),
  comment text,
  due_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reviews_org_id_idx on reviews(org_id, created_at desc);
create index if not exists reviews_assignee_idx on reviews(org_id, assignee_id);
create index if not exists reviews_status_idx on reviews(org_id, status);
create index if not exists reviews_claim_idx on reviews(org_id, claim_id);
