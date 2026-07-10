import { z } from "zod";

// Zod contracts for the data-source provenance registry. These validate the
// shapes the repository returns and accepts so nothing untyped crosses the API
// boundary. source_key is a stable machine key: lowercase, snake-friendly.

export const sourceKeySchema = z
  .string()
  .trim()
  .min(1, "source_key is required")
  .max(64, "source_key too long")
  .regex(/^[a-z0-9_]+$/, "source_key must be lowercase alphanumeric/underscore");

// A single registry row: public reference facts about one open data source.
export const dataSourceSchema = z.object({
  id: z.string().uuid(),
  sourceKey: sourceKeySchema,
  displayName: z.string().min(1),
  databaseVersion: z.string().nullable(),
  license: z.string().nullable(),
  url: z.string().nullable(),
  lastAccessedAt: z.string().nullable(),
  snapshotDate: z.string().nullable(),
  createdAt: z.string(),
});

export type DataSource = z.infer<typeof dataSourceSchema>;

// A static catalog entry (the seed data). No id/createdAt — those are DB-owned.
export const catalogEntrySchema = z.object({
  sourceKey: sourceKeySchema,
  displayName: z.string().min(1),
  databaseVersion: z.string().nullable(),
  license: z.string().min(1),
  url: z.string().url(),
  snapshotDate: z.string().nullable(),
});

export type CatalogEntry = z.infer<typeof catalogEntrySchema>;

// An append-only access-log row. org_id is nullable (platform-internal accesses
// have no tenant); when present it is always the RESOLVED ctx.org.id.
export const sourceAccessSchema = z.object({
  id: z.string().uuid(),
  sourceKey: sourceKeySchema,
  orgId: z.string().uuid().nullable(),
  purpose: z.string().min(1),
  accessedAt: z.string(),
});

export type SourceAccess = z.infer<typeof sourceAccessSchema>;

// Input to recordAccess. purpose is a short free-text reason (e.g. the claim id
// or engine name) explaining why the source was consulted.
export const recordAccessInputSchema = z.object({
  sourceKey: sourceKeySchema,
  purpose: z.string().trim().min(1, "purpose is required").max(256),
});

export type RecordAccessInput = z.infer<typeof recordAccessInputSchema>;
