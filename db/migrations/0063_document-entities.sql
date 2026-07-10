-- INGEST-TIME entity canonicalization index: document_entities.
--
-- Phase 2 (multi-source ingest) turns PaperTrail from a literature verifier into an
-- EVIDENCE INTEGRATOR. Every cached source row (sources) is tagged, AT INGEST TIME, with
-- the canonical ontology CURIEs the deterministic linker resolved from its text
-- (lib/entities/canonicalize.ts resolveMany), driven by the NER surface mentions
-- (lib/entities/ner.ts recognizeEntities — the ONLY Claude call in the linking chain).
--
-- This table is the persisted join between a cached document and the canonical entities
-- it mentions, so downstream retrieval can ask "which cached sources mention HGNC:6024?"
-- WITHOUT re-running NER or re-fetching from the network (CLAUDE.md cache-everything rule:
-- never live-fetch on a path a cached row can serve). One row per (source, curie, span).
--
-- House style follows 0001_foundation.sql / 0062_bio-ontology.sql: idempotent DDL
-- (`create ... if not exists`), lower-case SQL, explicit indexes, additive columns via
-- add-column-if-not-exists so re-running the migration is always safe.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- document_entities — one row per canonical entity mention grounded in a cached source's
-- raw_text. `curie` is the stable ontology id the deterministic canonicalizer resolved
-- (HGNC:6024, EFO:0000756, ...); `surface` is the verbatim substring that was tagged;
-- offsets point into sources.raw_text (nullable when grounding could not place a span but
-- the mention still resolved). match_type / score carry the DETERMINISTIC linker
-- provenance (never an LLM number). No org_id: this indexes the shared sources cache,
-- which is itself global in this schema (see db/migrations.sql).
-- ---------------------------------------------------------------------------
create table if not exists document_entities (
  id           uuid primary key default gen_random_uuid(),
  source_id    uuid not null references sources(id) on delete cascade,
  curie        text not null,                 -- canonical ontology CURIE (HGNC:6024, EFO:0000756, ...)
  surface      text not null,                 -- verbatim tagged substring of sources.raw_text
  ontology     text not null,                 -- owning ontology of the CURIE (HGNC | EFO | MONDO | ...)
  start_offset integer,                        -- char offset into raw_text (null when unlocatable)
  end_offset   integer,                        -- char end offset into raw_text (null when unlocatable)
  match_type   text not null default 'exact', -- deterministic linker match kind (exact | ...)
  score        double precision not null default 1.0, -- deterministic string-match confidence in [0,1]
  linked_at    timestamptz not null default now()
);

-- Idempotent uniqueness: the same canonical entity at the same span in the same document
-- collapses to one row, so re-ingesting a document does not duplicate its entities.
-- coalesce keeps null offsets from defeating the unique constraint (null != null in SQL).
create unique index if not exists document_entities_span_uniq
  on document_entities (source_id, curie, coalesce(start_offset, -1), coalesce(end_offset, -1));

-- Hot path: "which cached sources mention this canonical entity?" — the by-entity route.
create index if not exists document_entities_curie_idx on document_entities (curie);
-- Cascade-friendly + "all entities for this document" lookups.
create index if not exists document_entities_source_id_idx on document_entities (source_id);
