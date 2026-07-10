-- Multi-source ingest (Phase 2): turn PaperTrail from a literature verifier into an
-- EVIDENCE INTEGRATOR that pulls from PubMed + CT.gov + OpenFDA/FAERS + ClinVar +
-- ChEMBL + Open Targets + PubTator into the shared `sources` cache, with per-source
-- PROVENANCE (version + snapshot + access log) and INGEST-TIME entity canonicalization
-- (canonical CURIEs persisted per document).
--
-- The `sources` table itself already exists (db/migrations.sql: uuid pk, unique
-- (source_type, external_id), embedding vector(1024)). We do NOT recreate it — this
-- migration is strictly ADDITIVE: new columns via `add column if not exists`, new tables
-- via `create table if not exists`, so it is safe to run repeatedly (idempotent) and
-- never rewrites an existing row's shape.
--
-- House style follows 0001_foundation.sql / 0062_bio-ontology.sql: lower-case SQL,
-- uuid pks via gen_random_uuid(), explicit `if not exists` indexes. No org_id here —
-- the cache is the existing (public, shared) `sources` shape, deliberately unchanged.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- (1) sources — additive provenance + per-source-type external identity columns.
--
-- The multi-source pipeline caches heterogeneous evidence (variants, compounds,
-- adverse-event terms) into the SAME `sources` row shape. These optional columns let a
-- cached row carry the domain-specific identity the retriever/verifier needs WITHOUT a
-- new table per source:
--   variant_id        — ClinVar / dbSNP variant identity (e.g. 'rs113488022', 'VCV000013961')
--   compound_id       — ChEMBL / drug compound identity (e.g. 'CHEMBL1201585')
--   adverse_event_cui — OpenFDA/FAERS MedDRA adverse-event concept id (UMLS CUI / PT code)
-- Every column is nullable — a PubMed abstract simply leaves them null; a ClinVar record
-- populates variant_id. No existing row is touched.
--
-- PROVENANCE columns make each cached row auditable and reproducible:
--   source_version    — upstream release/version the row was pulled from
--                        (e.g. ChEMBL '34', ClinVar '2026-06', OpenFDA quarter)
--   source_snapshot_id — opaque snapshot handle tying the row to a source_access_log entry
--   snapshot_date     — when the underlying source snapshot was taken (NOT fetched_at,
--                        which is when WE cached it; these can differ for versioned dumps)
-- ---------------------------------------------------------------------------
alter table sources add column if not exists variant_id text;
alter table sources add column if not exists compound_id text;
alter table sources add column if not exists adverse_event_cui text;
alter table sources add column if not exists source_version text;
alter table sources add column if not exists source_snapshot_id text;
alter table sources add column if not exists snapshot_date timestamptz;

-- The original sources.source_type CHECK only allowed ('pubmed','clinicaltrials'). The
-- multi-source pipeline caches faers/clinvar/chembl/opentargets/pubtator rows into the
-- same table, so drop the restrictive constraint (unique(source_type, external_id) still
-- enforces identity; source_type becomes a free provider label).
alter table sources drop constraint if exists sources_source_type_check;

-- Domain-identity lookups: resolve a cached row by its variant / compound / adverse-event
-- id without scanning. Partial indexes keep them tiny (only rows that carry each id).
create index if not exists sources_variant_id_idx
  on sources (variant_id) where variant_id is not null;
create index if not exists sources_compound_id_idx
  on sources (compound_id) where compound_id is not null;
create index if not exists sources_adverse_event_cui_idx
  on sources (adverse_event_cui) where adverse_event_cui is not null;

-- NOTE: document_entities is defined in 0063_document-entities.sql (which sorts first),
-- so it is intentionally NOT recreated here — that file owns its (stricter) shape and the
-- entityCanonicalization insert matches it. This file only adds sources columns + the
-- access log.

-- ---------------------------------------------------------------------------
-- (3) source_access_log — provenance / recordAccess trail.
--
-- One row per access the pipeline records against an upstream source, capturing the
-- license and snapshot the data was served under. This is the audit trail behind the
-- cache-everything rule: a cached `sources` row's source_snapshot_id points at the
-- snapshot recorded here, so the demo can prove WHEN and under WHAT license/version each
-- piece of evidence entered the cache — without ever re-hitting the live API.
--
--   source_type — provider the access hit ('pubmed' | 'clinicaltrials' | 'openfda' |
--                 'clinvar' | 'chembl' | 'opentargets' | 'pubtator' | ...)
--   external_id — the id accessed at that provider (nullable for search-only accesses)
--   accessed_at — when WE accessed the provider
--   license     — the license the data was served under (provenance for redistribution)
--   snapshot_id — snapshot handle joining back to sources.source_snapshot_id
-- ---------------------------------------------------------------------------
create table if not exists source_access_log (
  id          uuid primary key default gen_random_uuid(),
  source_type text,
  external_id text,
  accessed_at timestamptz default now(),
  license     text,
  snapshot_id text
);

-- Provenance queries by provider (recent-access-first) and by snapshot handle.
create index if not exists source_access_log_source_type_idx
  on source_access_log (source_type, accessed_at desc);
create index if not exists source_access_log_snapshot_id_idx
  on source_access_log (snapshot_id) where snapshot_id is not null;
