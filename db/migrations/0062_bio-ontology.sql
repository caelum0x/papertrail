-- Biomedical Ontology & Marker Reference layer.
--
-- The DETERMINISTIC entity-linking / canonicalization step (lib/entities/canonicalize.ts)
-- resolves a free-text surface form (e.g. "PD-1", "CD8 exhausted") to a stable ontology
-- CURIE (HGNC:11213, EFO:0000756, ...) WITHOUT an LLM in the loop. Claude is used only for
-- NER (lib/entities/ner.ts); the id-resolution here is a pure lexical lookup against this
-- curated reference, so the resolved identity is reproducible and auditable.
--
-- These tables are PUBLIC reference data (no org_id), mirroring bio_cache (0051) and
-- kg_nodes/kg_edges (0052): ontology facts are shared across all tenants, unlike the
-- org-scoped sources / evidence_reports tables. House style follows 0001_foundation.sql:
-- idempotent DDL (`create ... if not exists`), lower-case SQL, uuid pks via
-- gen_random_uuid(), and explicit indexes.
--
-- We ship a CURATED starter seed (scripts/ingest-ontology.ts + lib/bio/ontologyData.ts)
-- rather than the multi-GB full ontology dumps: an honest, well-provenanced subset covering
-- the genes / diseases / drugs / immune cell populations the demo actually exercises, with
-- source + pmid on every marker row. Coverage is logged at ingest time.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- ontology_terms — one row per canonical concept, keyed by its CURIE
-- (compact URI, e.g. "HGNC:6024", "EFO:0000756"). `term_type` lets the
-- canonicalizer filter by the kind of entity the NER step tagged (gene / disease /
-- drug / cell_type / ...). Obsolete terms are retained with a `replaced_by` pointer so
-- a stale surface form still resolves, then forwards to the live concept.
-- ---------------------------------------------------------------------------
create table if not exists ontology_terms (
  curie       text primary key,               -- 'HGNC:6024' | 'EFO:0000756' | 'CHEMBL:CHEMBL1201585' | ...
  ontology    text not null,                  -- 'HGNC' | 'EFO' | 'MONDO' | 'ChEMBL' | 'CL' | 'UBERON' | ...
  label       text not null,                  -- canonical human-readable label
  term_type   text,                           -- 'gene' | 'disease' | 'drug' | 'cell_type' | 'tissue' | ...
  obsolete    boolean not null default false,
  replaced_by text                            -- curie of the replacement term when obsolete
);

-- Filter candidate terms by kind during canonicalization (term_type narrowing).
create index if not exists ontology_terms_term_type_idx on ontology_terms (term_type);

-- ---------------------------------------------------------------------------
-- ontology_synonyms — every surface form that should resolve to a term.
-- `synonym_norm` is the normalized (lower-cased, whitespace-collapsed) form the
-- canonicalizer matches against; the functional index on lower(synonym_norm) keeps the
-- exact-match lookup fast even though the column is normalized on write.
-- ---------------------------------------------------------------------------
create table if not exists ontology_synonyms (
  curie        text not null references ontology_terms(curie) on delete cascade,
  synonym_norm text not null,                  -- normalized surface form (lowercase, collapsed ws)
  source       text                            -- provenance of this synonym ('HGNC' | 'label' | 'curated' | ...)
);

-- The single hot path of the canonicalizer: exact match on the normalized synonym.
create index if not exists ontology_synonyms_norm_idx on ontology_synonyms (lower(synonym_norm));
-- Cascade-friendly + de-dup lookups by owning term.
create index if not exists ontology_synonyms_curie_idx on ontology_synonyms (curie);

-- ---------------------------------------------------------------------------
-- ontology_xrefs — cross-references from a term to equivalent ids in other
-- databases (e.g. HGNC:6024 -> 'NCBIGene:3574', 'ensembl:ENSG00000168685'). The
-- canonicalizer surfaces these so a resolved entity carries its cross-database identity.
-- ---------------------------------------------------------------------------
create table if not exists ontology_xrefs (
  curie      text not null references ontology_terms(curie) on delete cascade,
  xref_curie text not null                     -- equivalent id in another namespace
);

create index if not exists ontology_xrefs_curie_idx on ontology_xrefs (curie);

-- ---------------------------------------------------------------------------
-- ontology_edges — typed relations between terms (is_a / part_of / has_marker / ...).
-- Kept deliberately thin (subject / predicate / object CURIEs); the provenance-bearing
-- evidence graph lives in kg_edges (0052). This is the ontology backbone the canonicalizer
-- and marker lookups can walk (e.g. a cell-type is_a hierarchy).
-- ---------------------------------------------------------------------------
create table if not exists ontology_edges (
  subject_curie text not null,
  predicate     text not null,                 -- 'is_a' | 'part_of' | 'has_marker' | ...
  object_curie  text not null
);

create index if not exists ontology_edges_subject_idx on ontology_edges (subject_curie);
create index if not exists ontology_edges_object_idx on ontology_edges (object_curie);

-- ---------------------------------------------------------------------------
-- cell_marker_panels — curated marker genes for canonical immune cell populations,
-- with the DIRECTION of the marker (positive / negative) and full provenance
-- (source database + pmid). This is what lets the deterministic layer reason about
-- single-cell / immune claims (e.g. "CD8 exhausted T cells are PDCD1+ TOX+") against a
-- referenced marker table rather than an LLM's recollection.
-- ---------------------------------------------------------------------------
create table if not exists cell_marker_panels (
  id              uuid primary key default gen_random_uuid(),
  cell_type_curie text,                         -- CL/curated cell-type CURIE
  cell_type_label text,                         -- human-readable population name
  gene_curie      text,                         -- HGNC CURIE of the marker gene
  gene_symbol     text,                         -- HGNC symbol of the marker gene
  direction       text,                         -- 'positive' | 'negative'
  tissue_curie    text,                         -- optional UBERON tissue context
  source          text,                         -- 'CellMarker2.0' | 'PanglaoDB' | 'curated'
  pmid            text                          -- supporting publication
);

create index if not exists cell_marker_panels_cell_type_curie_idx on cell_marker_panels (cell_type_curie);
create index if not exists cell_marker_panels_gene_symbol_idx on cell_marker_panels (gene_symbol);

-- ---------------------------------------------------------------------------
-- gene_signatures — named gene sets (e.g. an ICB-responder memory signature), stored as
-- an array of HGNC symbols with provenance. Lets the deterministic layer check
-- signature-level claims against a referenced list rather than a generated one.
-- ---------------------------------------------------------------------------
create table if not exists gene_signatures (
  signature_id text primary key,               -- stable slug id, e.g. 'ICB_RESPONDER_MEMORY'
  name         text,                            -- human-readable name
  source       text,                            -- originating collection / curation
  gene_symbols text[],                          -- HGNC symbols in the signature
  provenance   text                             -- reference / pmid / description
);
