import { z } from "zod";

// Validation + shared types for per-engine SLA observability. These describe the
// public shape of the SLA summary; the recorder itself (engineMetrics.ts) never
// trusts unbounded input — engine names and latencies are clamped/validated here.

// A single recorded engine call. latencyMs must be finite and non-negative; ok
// marks success (used to compute errorRate).
export const engineCallSchema = z.object({
  engine: z.string().trim().min(1, "engine is required").max(120),
  latencyMs: z.number().finite().nonnegative().max(600000),
  ok: z.boolean(),
});
export type EngineCall = z.infer<typeof engineCallSchema>;

// Per-engine rolling SLA figures. All latencies are milliseconds; errorRate is a
// fraction in [0, 1]. Computed deterministically from the ring buffer.
export interface EngineSla {
  engine: string;
  calls: number;
  errors: number;
  errorRate: number;
  availability: number; // 1 - errorRate, convenience for SLA dashboards
  p50: number;
  p95: number;
  p99: number;
  maxLatencyMs: number;
  windowSize: number; // capacity of the ring buffer (documented window)
}

// The full status payload returned by GET /api/observability/engines.
export interface EngineSlaSummary {
  generatedAt: string;
  windowSize: number;
  engines: EngineSla[];
}
