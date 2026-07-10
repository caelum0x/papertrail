-- Biomedical Evidence Knowledge Graph.
--
-- A persisted, PROVENANCE-BEARING graph of biomedical entities (nodes) and the
-- typed relations between them (edges), assembled across the open bio corpus
-- (PubTator-normalized entities + the deterministic bio-relation engines). It lets
-- callers query evidence PATHS between two entities (e.g. drug -> gene ->
-- associates_with -> disease) where EVERY edge carries where it came from.
--
-- MOAT: unlike a black-box "we think these are related", every edge stores its
-- provenance jsonb — the source, an evidence reference, the grounded quote the
-- relation was drawn from, and a DETERMINISTIC confidence produced by the bio
-- engines (never an LLM-invented number). A path is only as trustworthy as the
-- provenance on the edges that compose it, and that provenance travels with it.
--
-- NOT org-scoped: these are PUBLIC reference facts derived from open bio-data
-- (mirrors bio_cache in 0051_bio-cache.sql), shared across all tenants — unlike the
-- org-scoped evidence_reports / sources tables. House style follows
-- 0001_foundation.sql: idempotent DDL, uuid pks via gen_random_uuid(), lower-case
-- SQL, `create ... if not exists`, explicit indexes.

create extension if not exists pgcrypto;

-- Nodes: one row per distinct normalized biomedical entity. `normalized_id` is the
-- database-qualified identifier the grounding layer resolved (e.g. "NCBI Gene:673",
-- "MESH:D009369", Ensembl "ENSG..."), so the same real-world entity collapses to a
-- single node regardless of surface spelling. The unique(entity_type, normalized_id)
-- constraint is the upsert target — a gene and a disease that happen to share an id
-- string still stay distinct nodes.
create table if not exists kg_nodes (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null,                    -- 'gene' | 'disease' | 'chemical' | 'variant' | 'species' | 'drug' | ...
  name          text not null,                    -- canonical / first-seen surface form, human-readable
  normalized_id text not null,                     -- database-qualified id from the grounding layer
  created_at    timestamptz not null default now(),
  unique (entity_type, normalized_id)
);

-- Edges: one row per (subject, predicate, object) triple. `predicate` is the typed
-- relation (e.g. 'associates_with', 'targets', 'treats'). `provenance` carries the
-- audit trail for THIS edge as jsonb: { source, evidence_ref, grounded_quote, score }.
-- The unique(subject_id, predicate, object_id) constraint makes edge upserts
-- idempotent — re-ingesting the same triple refreshes its provenance rather than
-- duplicating the relation.
create table if not exists kg_edges (
  id          uuid primary key default gen_random_uuid(),
  subject_id  uuid not null references kg_nodes(id) on delete cascade,
  predicate   text not null,
  object_id   uuid not null references kg_nodes(id) on delete cascade,
  provenance  jsonb not null default '{}'::jsonb,  -- { source, evidence_ref, grounded_quote, score }
  created_at  timestamptz not null default now(),
  unique (subject_id, predicate, object_id)
);

-- Traversal indexes. Path-finding walks edges outward from a node (by subject_id)
-- and, for undirected/inbound exploration, by object_id; predicate lookups filter
-- by relation type. These three cover the recursive edge walk in the repository.
create index if not exists kg_edges_subject_id_idx on kg_edges (subject_id);
create index if not exists kg_edges_object_id_idx on kg_edges (object_id);
create index if not exists kg_edges_predicate_idx on kg_edges (predicate);

-- Resolve a node quickly by its normalized identity during ingestion upserts.
create index if not exists kg_nodes_normalized_id_idx on kg_nodes (normalized_id);
