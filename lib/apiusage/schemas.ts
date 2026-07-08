import { z } from "zod";

// Zod schemas for the API-usage analytics module. All LLM-free, but we still
// validate every query-string input at the route boundary before it reaches SQL
// (fail fast, never trust external data). Types are inferred from the schemas so
// the client and server agree on one source of truth.

// A window, in days, over which summary / timeseries roll up. Clamped 1..365.
export const RANGE_DAYS_MIN = 1;
export const RANGE_DAYS_MAX = 365;
export const RANGE_DAYS_DEFAULT = 30;

// Timeseries buckets, coarsest first for the picker. `hour` only makes sense for
// short windows; the query clamps range accordingly but the value is still valid.
export const bucketSchema = z.enum(["hour", "day", "week"]);
export type Bucket = z.infer<typeof bucketSchema>;

// Shared range parser: accepts a raw ?days string, coerces + clamps.
export const rangeQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .min(RANGE_DAYS_MIN)
    .max(RANGE_DAYS_MAX)
    .default(RANGE_DAYS_DEFAULT),
});
export type RangeQuery = z.infer<typeof rangeQuerySchema>;

export const timeseriesQuerySchema = rangeQuerySchema.extend({
  bucket: bucketSchema.default("day"),
});
export type TimeseriesQuery = z.infer<typeof timeseriesQuerySchema>;

// Optional filters on the paginated request log. All optional; empty = no filter.
export const requestLogQuerySchema = z.object({
  route: z.string().trim().min(1).max(256).optional(),
  method: z
    .enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
    .optional(),
  apiKeyId: z.string().uuid().optional(),
  // "errors" restricts to status_code >= 400; "success" to < 400.
  status: z.enum(["all", "success", "errors"]).default("all"),
});
export type RequestLogQuery = z.infer<typeof requestLogQuerySchema>;

export const rateLimitQuerySchema = z.object({
  route: z.string().trim().min(1).max(256).optional(),
  apiKeyId: z.string().uuid().optional(),
});
export type RateLimitQuery = z.infer<typeof rateLimitQuerySchema>;

// Input to recordApiRequest — validated so a mis-wired caller can't write junk.
export const recordApiRequestSchema = z.object({
  orgId: z.string().uuid(),
  apiKeyId: z.string().uuid().nullable().optional(),
  route: z.string().trim().min(1).max(256),
  method: z.string().trim().min(1).max(16),
  statusCode: z.number().int().min(100).max(599),
  durationMs: z.number().int().min(0).max(3_600_000).default(0),
});
export type RecordApiRequestInput = z.infer<typeof recordApiRequestSchema>;

export const recordRateLimitEventSchema = z.object({
  orgId: z.string().uuid(),
  apiKeyId: z.string().uuid().nullable().optional(),
  route: z.string().trim().min(1).max(256),
});
export type RecordRateLimitEventInput = z.infer<
  typeof recordRateLimitEventSchema
>;
