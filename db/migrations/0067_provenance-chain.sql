-- Immutable provenance / snapshot versioning (21 CFR Part 11-grade chain of custody).
--
-- A single cached `source` (in db/migrations.sql) holds only its LATEST fetched
-- raw_text. For an auditable provenance trail we must be able to reconstruct the
-- EXACT version of a source that was in effect when a given verification quoted it.
-- `evidence_source_versions` is an append-only snapshot ledger: each row records a
-- content-addressed snapshot of a source (its content_hash) alongside the external
-- identifiers (doi/pmid), the upstream source_version label, and when the snapshot
-- was taken. buildChainOfCustody() joins a verification's grounded spans to the
-- source-version that was current at export time.
--
-- Idempotent — safe to run repeatedly.

create table if not exists evidence_source_versions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  source_version text,
  snapshot_date timestamptz,
  doi text,
  pmid text,
  content_hash text,
  recorded_at timestamptz default now()
);

create index if not exists evidence_source_versions_source_id_idx
  on evidence_source_versions (source_id);
