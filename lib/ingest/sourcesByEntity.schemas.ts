import { z } from "zod";

// Request validation for the "sources tagged with a canonical entity" routes.
//
// A CURIE is a compact URI of the form <prefix>:<local-id> (HGNC:6024, EFO:0000756,
// CHEMBL:CHEMBL1201585, ...). We validate the SHAPE at the trust boundary (never trust a
// raw query param): a non-empty prefix, a colon, and a non-empty local id, length-capped
// so a pathological string can't reach the DB. limit/offset are coerced from their string
// query-param form and bounded; the queries layer clamps again defensively.

const CURIE_RE = /^[A-Za-z0-9._]+:[A-Za-z0-9._-]+$/;

export const SourcesByEntityQuerySchema = z.object({
  curie: z
    .string()
    .trim()
    .min(3)
    .max(128)
    .regex(CURIE_RE, "curie must be a CURIE of the form PREFIX:LOCAL_ID (e.g. HGNC:6024)"),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type SourcesByEntityQuery = z.infer<typeof SourcesByEntityQuerySchema>;

// The path-param variant (/api/entities/[curie]/sources) validates only the CURIE from the
// path; limit/offset still come from the query string.
export const CurieParamSchema = z
  .string()
  .trim()
  .min(3)
  .max(128)
  .regex(CURIE_RE, "curie must be a CURIE of the form PREFIX:LOCAL_ID (e.g. HGNC:6024)");

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
