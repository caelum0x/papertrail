import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import {
  recordApiRequestSchema,
  recordRateLimitEventSchema,
  type RecordApiRequestInput,
  type RecordRateLimitEventInput,
} from "./schemas";

// Write side of the API-usage analytics module. Callers (the public API request
// pipeline / rate limiter) invoke these to record telemetry. Like writeAudit,
// recording is best-effort: a telemetry failure must never break the request it
// is describing, so errors are swallowed after validation. Inputs are validated
// so a mis-wired caller can't insert malformed rows.

export async function recordApiRequest(
  input: RecordApiRequestInput,
  pool: Pool = getPool()
): Promise<void> {
  const parsed = recordApiRequestSchema.safeParse(input);
  if (!parsed.success) {
    // Invalid telemetry is dropped rather than thrown — recording is best-effort.
    return;
  }
  const data = parsed.data;
  try {
    await pool.query(
      `insert into api_requests
         (org_id, api_key_id, route, method, status_code, duration_ms)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        data.orgId,
        data.apiKeyId ?? null,
        data.route,
        data.method.toUpperCase(),
        data.statusCode,
        data.durationMs,
      ]
    );
  } catch {
    // Best-effort: never fail the originating request over telemetry.
  }
}

export async function recordRateLimitEvent(
  input: RecordRateLimitEventInput,
  pool: Pool = getPool()
): Promise<void> {
  const parsed = recordRateLimitEventSchema.safeParse(input);
  if (!parsed.success) {
    return;
  }
  const data = parsed.data;
  try {
    await pool.query(
      `insert into rate_limit_events (org_id, api_key_id, route)
       values ($1, $2, $3)`,
      [data.orgId, data.apiKeyId ?? null, data.route]
    );
  } catch {
    // Best-effort.
  }
}
