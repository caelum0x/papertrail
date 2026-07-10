-- DATA-SOURCE PROVENANCE REGISTRY. The audit an FDA/HTA reviewer expects: every
-- evidence number PaperTrail produces traces back to a source record that names
-- the database it came from, the version/snapshot it was drawn from, the license
-- under which it was used, and when it was last accessed.
--
--   * evidence_data_sources    — the reference registry of the platform's open
--     data sources (Open Targets, GWAS Catalog, ClinVar, ChEMBL, PharmGKB, FAERS,
--     PubTator, PubMed, ClinicalTrials.gov). These are PUBLIC reference facts —
--     license + url + version — not org-scoped. `source_key` is the stable
--     machine key the engines cite; it is unique so upserts are idempotent.
--   * evidence_source_accesses — an append-only ACCESS LOG: each time a source is
--     consulted for a purpose, we record which org consulted it and when. This is
--     ORG-SCOPED (org_id nullable for platform-internal accesses) so a tenant can
--     produce its own provenance trail without seeing another tenant's.
--
-- Idempotent: safe to run repeatedly (IF NOT EXISTS everywhere).

create table if not exists evidence_data_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  display_name text not null,
  database_version text,
  license text,
  url text,
  last_accessed_at timestamptz,
  snapshot_date date,
  created_at timestamptz not null default now()
);

create table if not exists evidence_source_accesses (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  org_id uuid references orgs(id) on delete cascade,
  purpose text not null,
  accessed_at timestamptz not null default now()
);

-- org_id first: the access log is queried per-tenant, newest first.
create index if not exists evidence_source_accesses_org_id_idx
  on evidence_source_accesses(org_id, accessed_at desc);

create index if not exists evidence_source_accesses_source_key_idx
  on evidence_source_accesses(source_key, accessed_at desc);
