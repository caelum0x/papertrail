-- Publication planning & medical-writing (MLR-style). Models the workflow a
-- medical-writing / publications team uses to plan a manuscript or congress
-- output: a publication record, the set of verified claims attached to it, and
-- the Medical/Legal/Regulatory (MLR) review decisions gating its release.
--
-- Multi-tenant: org_id on every row. Idempotent — safe to run repeatedly.
-- project_id, publication_id and claim_id that point at sibling-module tables
-- are plain uuids (no cross-module FK) so this migration does not depend on the
-- migration order of the projects/claims modules; the app validates ownership by
-- org_id at write time. publication_id/reviewer references within this module do
-- use FKs since those tables live here.

create table if not exists publications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid,
  title text not null,
  type text not null default 'manuscript'
    check (type in (
      'manuscript', 'abstract', 'poster', 'slide_deck', 'other'
    )),
  target_journal text,
  status text not null default 'planning'
    check (status in (
      'planning', 'in_review', 'approved', 'published', 'archived'
    )),
  stage text not null default 'concept'
    check (stage in (
      'concept', 'outline', 'first_draft', 'internal_review',
      'mlr_review', 'final'
    )),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists publications_org_id_idx
  on publications(org_id, created_at desc);
create index if not exists publications_project_id_idx on publications(project_id);
create index if not exists publications_status_idx on publications(org_id, status);

-- A verified claim attached to a publication. claim_id references the claims
-- module's table by id (validated by org_id at write time). status tracks the
-- claim's inclusion state within the publication (proposed -> included/removed).
create table if not exists publication_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  publication_id uuid not null references publications(id) on delete cascade,
  claim_id uuid not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'included', 'removed')),
  created_at timestamptz not null default now()
);

create index if not exists publication_claims_pub_idx
  on publication_claims(org_id, publication_id, created_at desc);
create index if not exists publication_claims_claim_idx
  on publication_claims(org_id, claim_id);
-- A claim can only be attached to a given publication once.
create unique index if not exists publication_claims_uniq
  on publication_claims(publication_id, claim_id);

-- An MLR review decision. Each reviewer role (medical, legal, regulatory) records
-- an approve/reject/changes decision with comments. Append-only history: the
-- latest decision per role reflects the current sign-off status.
create table if not exists mlr_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  publication_id uuid not null references publications(id) on delete cascade,
  reviewer_id uuid references users(id) on delete set null,
  role text not null
    check (role in ('medical', 'legal', 'regulatory', 'editorial')),
  decision text not null
    check (decision in ('approved', 'rejected', 'changes_requested')),
  comments text,
  created_at timestamptz not null default now()
);

create index if not exists mlr_reviews_pub_idx
  on mlr_reviews(org_id, publication_id, created_at desc);
create index if not exists mlr_reviews_role_idx
  on mlr_reviews(org_id, publication_id, role);
