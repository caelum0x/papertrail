// SHARED DRIVER CONTRACT for the multi-source ingest pipeline.
//
// Each driver (faers, clinvar, chembl, openTargets, pubtator) wraps an EXISTING
// lib/bio/* query engine and maps its deterministic result into a cacheable source
// record — the SAME shape the `sources` table stores. Drivers do NOT touch the DB
// themselves for caching; they only PRODUCE records. The pipeline
// (multiSourcePipeline.ts) owns the cache-once check + insert + provenance so that
// "never re-fetch a cached (source_type, external_id)" is enforced in one place.
//
// MOAT: nothing here calls an LLM; every value is what the bio engine returned. On any
// upstream failure a driver returns [] (honest empty), never a fabricated record.

import type { Pool } from "pg";

// The immutable, cacheable shape of one retrieved source, mirroring the `sources` table
// columns searchAndCache.ts writes plus a structured `metadata` blob for the extra
// per-source provenance columns (variant_id / compound_id / adverse_event_cui) and the
// database version/license the driver knows.
export interface CacheableSourceRecord {
  source_type: string;
  external_id: string;
  title: string;
  raw_text: string;
  url: string;
  metadata: SourceMetadata;
}

// Structured metadata a driver attaches to a record. Every field is optional; the
// pipeline reads the ones it maps to real `sources` columns and stamps the rest onto
// provenance. `license` + `sourceVersion` feed recordAccess; the id fields feed the
// additive sources columns.
export interface SourceMetadata {
  // The database version string the record was drawn from (e.g. "ChEMBL_34").
  sourceVersion?: string | null;
  // The redistribution license of the upstream data (surfaced for audit).
  license?: string | null;
  // Cross-source canonical ids for the additive sources columns. Only the field that
  // applies to this source type is set (variant for ClinVar, compound for ChEMBL, ...).
  variantId?: string | null;
  compoundId?: string | null;
  adverseEventCui?: string | null;
  // Any additional structured context the driver wants preserved on the record for
  // downstream display/debugging. Never contains a wall-clock timestamp used in a hash.
  extra?: Record<string, unknown>;
  // Index signature so a SourceMetadata is assignable to Record<string, unknown> when the
  // pipeline persists it as JSONB. Named fields above stay typed.
  [key: string]: unknown;
}

// What the pipeline hands a driver: the resolved query/entity + a limit. A driver uses
// whichever it can (FAERS needs a drug+event, ChEMBL a compound, ClinVar a variant/gene,
// Open Targets a target+disease, PubTator a query/PMIDs). Missing inputs a driver can't
// use → it returns [] rather than fabricating a lookup.
export interface DriverContext {
  // Free-text query (e.g. the claim's subject) when present.
  query: string | null;
  // A resolved entity surface + optional canonical curie/type from the pipeline input.
  entitySurface: string | null;
  entityCurie: string | null;
  entityType: string | null;
  // Per-driver record cap (already clamped by the pipeline).
  limit: number;
  // The pool, for drivers that read a cache/ontology table before fetching. Drivers must
  // NOT use it to write the sources cache — that is the pipeline's job.
  pool: Pool;
}

// A driver: pure mapping from context → cacheable records. Named + typed so the pipeline
// can select relevant drivers by `source_type` from input.sources.
export interface IngestDriver {
  // The stable source_type this driver produces (also its selection key in input.sources).
  sourceType: string;
  // Produce cacheable records for the given context. Returns [] on any failure/empty.
  fetch(context: DriverContext): Promise<CacheableSourceRecord[]>;
}
