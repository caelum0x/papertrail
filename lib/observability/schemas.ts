import { z } from "zod";
import { ERROR_LEVELS } from "@/lib/observability/types";

// Validation at the observability API boundary. Never trust raw request bodies
// or query params — parse them into typed, bounded values first.

// POST /api/observability/errors — ingest one error event.
export const ingestErrorSchema = z.object({
  level: z.enum(ERROR_LEVELS).default("error"),
  message: z.string().trim().min(1, "message is required").max(2000),
  context: z.record(z.string(), z.unknown()).optional().default({}),
});
export type IngestErrorInput = z.infer<typeof ingestErrorSchema>;

// Bounded lookback windows for the metrics/logs queries (in hours).
export const WINDOW_HOURS = {
  "1h": 1,
  "6h": 6,
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
} as const;

export type WindowKey = keyof typeof WINDOW_HOURS;

export const windowSchema = z
  .enum(["1h", "6h", "24h", "7d", "30d"])
  .default("24h");

// GET /api/observability/metrics query params.
export const metricsQuerySchema = z.object({
  metric: z.string().trim().min(1).max(120).optional(),
  window: windowSchema,
  buckets: z.coerce.number().int().min(6).max(200).default(48),
});
export type MetricsQuery = z.infer<typeof metricsQuerySchema>;

// GET /api/observability/logs query params.
export const logsQuerySchema = z.object({
  source: z.enum(["all", "error", "audit"]).default("all"),
  level: z.enum(ERROR_LEVELS).optional(),
  q: z.string().trim().max(200).optional(),
});
export type LogsQuery = z.infer<typeof logsQuerySchema>;

// GET /api/observability/errors query params.
export const errorsQuerySchema = z.object({
  level: z.enum(ERROR_LEVELS).optional(),
  q: z.string().trim().max(200).optional(),
});
export type ErrorsQuery = z.infer<typeof errorsQuerySchema>;
