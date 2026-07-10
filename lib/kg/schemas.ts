import { z } from "zod";

// Zod schemas + shared types for the Biomedical Evidence Knowledge Graph.
//
// Two roles (mirroring genetics.schemas / targets.schemas in this repo):
//   1. Validate the PUBLIC request body at the /api/kg boundary — never trust raw JSON.
//   2. Give the repository / graph layer typed, normalized shapes so the persistence
//      and traversal logic never has to defend against malformed records.
//
// Every edge carries PROVENANCE — where the relation came from, the grounded quote it
// was drawn from, and a DETERMINISTIC confidence produced by the bio engines. No LLM
// number is ever load-bearing here; these are ordinary structural schemas.

// ---------------------------------------------------------------------------
// Entity / node vocabulary.
//
// Supersets the five PubTator entity classes with the relation-derived types the bio
// engines emit (a "gene" is also a drug TARGET; a "drug" is a chemical acting on a
// target). Kept as a string-literal union per the repo's TS style; anything outside
// this set is dropped at ingestion rather than coerced — we never invent a type.
// ---------------------------------------------------------------------------

export const KG_ENTITY_TYPES = [
  "gene",
  "disease",
  "chemical",
  "variant",
  "species",
  "drug",
] as const;

export const KgEntityTypeSchema = z.enum(KG_ENTITY_TYPES);
export type KgEntityType = z.infer<typeof KgEntityTypeSchema>;

// ---------------------------------------------------------------------------
// Predicate vocabulary — the typed relations the graph stores.
//
// Derived deterministically from the bio-relation engines:
//   associates_with — gene/variant ⇄ disease (GWAS/ClinVar or Open Targets genetics)
//   targets         — drug ⇄ gene (Open Targets known-drug mechanism of action)
//   treats          — drug ⇄ disease (a drug with a known-drug association to the pair)
// A closed vocabulary keeps edges queryable and auditable; unknown predicates are
// never persisted.
// ---------------------------------------------------------------------------

export const KG_PREDICATES = [
  "associates_with",
  "targets",
  "treats",
] as const;

export const KgPredicateSchema = z.enum(KG_PREDICATES);
export type KgPredicate = z.infer<typeof KgPredicateSchema>;

// ---------------------------------------------------------------------------
// Provenance — the audit trail carried on EVERY edge.
//
// `source` names the engine/database the relation came from (e.g. 'gwas_catalog',
// 'open_targets'). `evidenceRef` is a stable reference into that source (a verdict
// name, an EFO/Ensembl id pair, a PMID) so an auditor can re-derive the edge.
// `groundedQuote` is the exact human-readable statement the relation was drawn from —
// never fabricated. `score` is a DETERMINISTIC confidence in [0, 1] the bio engine
// produced; there is no LLM in this number.
// ---------------------------------------------------------------------------

export const KgProvenanceSchema = z.object({
  source: z.string().min(1),
  evidenceRef: z.string().min(1),
  groundedQuote: z.string().min(1),
  score: z.number().min(0).max(1),
});
export type KgProvenance = z.infer<typeof KgProvenanceSchema>;

// A node as the repository persists / returns it.
export const KgNodeSchema = z.object({
  id: z.string().uuid(),
  entityType: KgEntityTypeSchema,
  name: z.string().min(1),
  normalizedId: z.string().min(1),
});
export type KgNode = z.infer<typeof KgNodeSchema>;

// The identity of a node to upsert (before it has a persisted id). Only the
// (entityType, normalizedId) pair is the unique key; `name` is descriptive.
export const KgNodeInputSchema = z.object({
  entityType: KgEntityTypeSchema,
  name: z.string().min(1),
  normalizedId: z.string().min(1),
});
export type KgNodeInput = z.infer<typeof KgNodeInputSchema>;

// An edge as the repository persists / returns it.
export const KgEdgeSchema = z.object({
  id: z.string().uuid(),
  subjectId: z.string().uuid(),
  predicate: KgPredicateSchema,
  objectId: z.string().uuid(),
  provenance: KgProvenanceSchema,
});
export type KgEdge = z.infer<typeof KgEdgeSchema>;

// A derived edge from the ingestion layer, before persistence — carries the two
// endpoint node inputs plus the typed predicate and its provenance. The graph layer
// resolves both endpoints to persisted node ids, then upserts the edge.
export const KgDerivedEdgeSchema = z.object({
  subject: KgNodeInputSchema,
  predicate: KgPredicateSchema,
  object: KgNodeInputSchema,
  provenance: KgProvenanceSchema,
});
export type KgDerivedEdge = z.infer<typeof KgDerivedEdgeSchema>;

// ---------------------------------------------------------------------------
// Path query result — a provenance-annotated evidence path between two nodes.
//
// `nodes` is the ordered chain from origin to destination (length hops+1); `edges`
// is the ordered relations connecting them (length hops), each carrying its own
// provenance. `hops` is the edge count. This is what queryPath returns and the API
// serializes.
// ---------------------------------------------------------------------------

export const KgPathSchema = z.object({
  nodes: z.array(KgNodeSchema),
  edges: z.array(KgEdgeSchema),
  hops: z.number().int().nonnegative(),
});
export type KgPath = z.infer<typeof KgPathSchema>;

// The result of an ingestion run: how many nodes/edges were written, and the derived
// edges (with provenance) that were persisted — an honest, auditable summary.
export const KgIngestResultSchema = z.object({
  nodesUpserted: z.number().int().nonnegative(),
  edgesUpserted: z.number().int().nonnegative(),
  edges: z.array(KgDerivedEdgeSchema),
});
export type KgIngestResult = z.infer<typeof KgIngestResultSchema>;

// ---------------------------------------------------------------------------
// Public request schema for POST /api/kg.
//
// Exactly one of `ingest` or `path` must be provided. `ingest.text` is free-form,
// length-capped, and never logged. `path.from` / `path.to` are normalized entity ids
// to find an evidence path between.
// ---------------------------------------------------------------------------

export const KgIngestRequestSchema = z.object({
  text: z.string().min(1).max(10_000),
});

export const KgPathRequestSchema = z.object({
  from: z.string().trim().min(1).max(128),
  to: z.string().trim().min(1).max(128),
  maxHops: z.number().int().min(1).max(6).optional(),
});

export const KgRequestSchema = z
  .object({
    ingest: KgIngestRequestSchema.optional(),
    path: KgPathRequestSchema.optional(),
  })
  .refine((body) => Boolean(body.ingest) !== Boolean(body.path), {
    message: "Provide exactly one of `ingest` or `path`.",
  });
export type KgRequest = z.infer<typeof KgRequestSchema>;
