import { z } from "zod";

// Zod schemas for per-engine usage metering. Every input crossing into SQL is
// validated first (fail fast, never trust external data), and types are inferred
// from the schemas so callers and the repository share one source of truth.

// Guardrails on a single metered call. units/tokens are non-negative and capped
// so a mis-wired caller cannot record an absurd or negative charge.
export const ENGINE_MAX_LEN = 128;
export const UNITS_MAX = 1_000_000;
export const CLAUDE_TOKENS_MAX = 100_000_000;

// A single metering event: which engine ran, for how many units, at what token
// cost. units defaults to 1 (one call) and claude_tokens to 0 (non-LLM engines).
export const recordEngineUsageSchema = z.object({
  orgId: z.string().uuid(),
  engine: z.string().trim().min(1).max(ENGINE_MAX_LEN),
  units: z.number().int().min(0).max(UNITS_MAX).default(1),
  claudeTokens: z.number().int().min(0).max(CLAUDE_TOKENS_MAX).default(0),
});
export type RecordEngineUsageInput = z.infer<typeof recordEngineUsageSchema>;

// Filters for a usage roll-up. `since` narrows to events at/after an instant;
// omitted means all-time for the org.
export const summarizeUsageSchema = z.object({
  orgId: z.string().uuid(),
  since: z.coerce.date().optional(),
});
export type SummarizeUsageInput = z.infer<typeof summarizeUsageSchema>;

// Per-engine roll-up row: how many events, total units, and total tokens the
// org spent on one engine.
export interface EngineUsageRow {
  engine: string;
  calls: number;
  units: number;
  claudeTokens: number;
}

// The full summary: per-engine breakdown plus org-wide totals across all engines.
export interface UsageSummary {
  engines: EngineUsageRow[];
  totals: {
    calls: number;
    units: number;
    claudeTokens: number;
  };
}
