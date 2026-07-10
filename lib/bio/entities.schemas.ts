// Zod schemas + shared types for the biomedical entity-normalization layer.
//
// PaperTrail's grounding layer maps free text / PMIDs to normalized bio-entities via
// NCBI PubTator Central (PubTator3). Every entity we surface is something PubTator
// actually resolved — never a fabricated or model-guessed entity. These schemas are
// the single boundary that decides what a "normalized entity" looks like, and they
// validate BOTH the request body (app/api/bio/annotate) and the shape we hand back to
// callers. Keep them small, pure, and free of side effects.

import { z } from "zod";

// The five entity classes PubTator3 resolves. String-literal union (not enum) per the
// repo's TS style. Anything PubTator emits outside this set is dropped rather than
// coerced — we never invent a type we can't ground.
export const EntityTypeSchema = z.enum([
  "gene",
  "disease",
  "chemical",
  "variant",
  "species",
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

// A single character span of the source text where the entity was mentioned. Offsets
// are 0-based into the annotated passage text, mirroring PubTator's BioC locations.
export const EntityOffsetSchema = z.object({
  start: z.number().int().nonnegative(),
  length: z.number().int().positive(),
});
export type EntityOffset = z.infer<typeof EntityOffsetSchema>;

// One normalized biomedical entity, as resolved by PubTator. `normalizedId` is the
// database-qualified identifier PubTator assigned (e.g. "NCBI Gene:673",
// "MESH:D009369", "dbSNP:rs334", "Species:9606"). It is nullable because PubTator can
// recognize a mention's type without confidently linking it to an ontology id — we
// keep the honest mention rather than dropping or fabricating an id.
export const BioEntitySchema = z.object({
  text: z.string().min(1),
  type: EntityTypeSchema,
  normalizedId: z.string().min(1).nullable(),
  offsets: z.array(EntityOffsetSchema),
});
export type BioEntity = z.infer<typeof BioEntitySchema>;

// Per-document annotation result. `pmid` is the source PMID for annotatePmids; for
// on-the-fly text annotation it is null (there is no PMID).
export const PmidAnnotationSchema = z.object({
  pmid: z.string().nullable(),
  entities: z.array(BioEntitySchema),
});
export type PmidAnnotation = z.infer<typeof PmidAnnotationSchema>;

// A group of de-duped entities sharing the same (type, normalizedId) key, with every
// distinct surface form and every offset it appeared at. This is the output of the
// pure normalizeEntities() helper.
export const NormalizedEntityGroupSchema = z.object({
  type: EntityTypeSchema,
  normalizedId: z.string().min(1).nullable(),
  // Distinct surface texts observed for this entity (order-preserving, de-duped).
  mentions: z.array(z.string().min(1)),
  // Every offset this entity was seen at across all mentions.
  offsets: z.array(EntityOffsetSchema),
  // How many raw annotations collapsed into this group.
  count: z.number().int().positive(),
});
export type NormalizedEntityGroup = z.infer<typeof NormalizedEntityGroupSchema>;

// ---------------------------------------------------------------------------
// Request schema for the public POST /api/bio/annotate route.
//
// Exactly one of `pmids` or `text` must be provided. PMIDs are digit strings; text is
// free-form and length-capped here (the route additionally sanitizes it and never
// logs it). We validate at the boundary and never trust the raw request body.
// ---------------------------------------------------------------------------

const PmidSchema = z
  .string()
  .trim()
  .regex(/^\d{1,9}$/, "PMID must be a numeric identifier.");

export const AnnotateRequestSchema = z
  .object({
    pmids: z.array(PmidSchema).min(1).max(50).optional(),
    text: z.string().min(1).max(10_000).optional(),
  })
  .refine(
    (body) => (body.pmids && body.pmids.length > 0) !== (typeof body.text === "string" && body.text.length > 0),
    { message: "Provide exactly one of `pmids` or `text`." }
  );
export type AnnotateRequest = z.infer<typeof AnnotateRequestSchema>;
