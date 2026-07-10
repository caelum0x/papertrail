import type { NextRequest } from "next/server";
import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import { fail } from "@/lib/api/response";
import { hashApiKey } from "@/lib/admin-audit/apiKeys";
import { checkQuota, recordUsage } from "@/lib/billing/usage";
import { recordApiRequest, recordRateLimitEvent } from "@/lib/apiusage/record";

// ---------------------------------------------------------------------------
// Enterprise API v1 gateway.
//
// withApiKey wraps a v1 route handler with the auth + metering + quota
// enforcement a pharma buyer's integration requires:
//   1. Resolve the org from an `Authorization: Bearer <api_key>` header by
//      hashing the presented key and looking it up in the org-scoped `api_keys`
//      table. The org id is derived SERVER-SIDE from the key row — a client
//      never asserts its own org id.
//   2. Enforce the org's per-plan quota for the metered `kind` BEFORE running
//      the engine (checkQuota). Over-quota requests are rejected 429 and the
//      rate-limit event is recorded.
//   3. Run the handler, then record usage: one metered unit against the plan
//      quota (recordUsage) and one telemetry row for analytics
//      (recordApiRequest). Recording is best-effort and never fails the request
//      it describes.
//
// This module is pure data access + deterministic control flow over existing
// modules (imported, never edited): admin-audit key crypto, billing quota,
// apiusage telemetry. All SQL is parameterized.
// ---------------------------------------------------------------------------

// The context handed to a v1 route handler. Deliberately minimal: only the org
// id resolved from the key, plus the resolved key id for audit correlation.
export interface ApiCtx {
  orgId: string;
  apiKeyId: string;
}

// A v1 route handler. Receives the raw request and the resolved ApiCtx.
export type ApiV1Handler = (
  req: NextRequest,
  ctx: ApiCtx
) => Promise<Response>;

// Options describing how a wrapped route meters against the org's plan quota.
export interface WithApiKeyOptions {
  // The billing quota kind this route consumes (e.g. "verification"). Must match
  // a plan-limit key; unlimited kinds are always allowed. Also used to label the
  // telemetry route so per-route analytics are stable across path changes.
  quotaKind: string;
  // The stable route label recorded in api_requests. Kept explicit (not derived
  // from req.url) so telemetry is not polluted by query strings or path params.
  routeLabel: string;
}

const BEARER_PREFIX = "Bearer ";

// A resolved, active key row. Only non-secret fields are read.
interface ResolvedKey {
  id: string;
  orgId: string;
}

// Extracts the raw key from an `Authorization: Bearer <key>` header. Returns
// null when the header is absent or malformed — never throws on client input.
function extractBearerKey(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    return null;
  }
  const raw = header.slice(BEARER_PREFIX.length).trim();
  return raw.length > 0 ? raw : null;
}

// Looks up an active (non-revoked) key by its hash and returns the owning org.
// The org id comes ONLY from this row — the client never supplies it. Returns
// null for an unknown or revoked key. Parameterized SQL only.
async function resolveKey(
  pool: Pool,
  rawKey: string
): Promise<ResolvedKey | null> {
  const keyHash = hashApiKey(rawKey);
  const { rows } = await pool.query(
    `select id, org_id
       from api_keys
      where key_hash = $1
        and revoked_at is null
      limit 1`,
    [keyHash]
  );
  if (rows.length === 0) {
    return null;
  }
  return { id: rows[0].id as string, orgId: rows[0].org_id as string };
}

// Best-effort stamp of last_used_at so operators can see key activity. Never
// throws: a telemetry write must not fail the request it describes.
async function touchKey(pool: Pool, keyId: string): Promise<void> {
  try {
    await pool.query(
      `update api_keys set last_used_at = now() where id = $1`,
      [keyId]
    );
  } catch {
    // Best-effort: activity stamping never fails the request.
  }
}

// Wraps a v1 route handler with API-key auth, per-plan quota enforcement, and
// usage metering. Rejects 401 on a bad/absent key and 429 over quota; otherwise
// runs the handler and records usage + telemetry.
export function withApiKey(
  handler: ApiV1Handler,
  options: WithApiKeyOptions
): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest): Promise<Response> => {
    const pool = getPool();
    const method = req.method ?? "POST";

    // 1. Authenticate. Absent or malformed header → 401 before any DB work.
    const rawKey = extractBearerKey(req);
    if (!rawKey) {
      return fail("Missing or malformed API key.", 401);
    }

    let resolved: ResolvedKey | null;
    try {
      resolved = await resolveKey(pool, rawKey);
    } catch {
      return fail("Could not verify API key.", 500);
    }
    if (!resolved) {
      return fail("Invalid or revoked API key.", 401);
    }

    const ctx: ApiCtx = { orgId: resolved.orgId, apiKeyId: resolved.id };

    // 2. Enforce quota BEFORE running the engine so a failed attempt or an
    //    over-quota request never burns billable work.
    let allowed: boolean;
    try {
      const decision = await checkQuota(ctx.orgId, options.quotaKind, 1);
      allowed = decision.allowed;
    } catch {
      return fail("Could not evaluate account quota.", 500);
    }

    if (!allowed) {
      await recordRateLimitEvent({
        orgId: ctx.orgId,
        apiKeyId: ctx.apiKeyId,
        route: options.routeLabel,
      });
      await recordApiRequest({
        orgId: ctx.orgId,
        apiKeyId: ctx.apiKeyId,
        route: options.routeLabel,
        method,
        statusCode: 429,
        durationMs: 0,
      });
      return fail("Plan quota exceeded for this billing period.", 429);
    }

    // 3. Run the handler, timing it for telemetry. A handler throw becomes a
    //    500 with the same telemetry so no request goes unrecorded.
    const startedAt = Date.now();
    await touchKey(pool, ctx.apiKeyId);

    let response: Response;
    try {
      response = await handler(req, ctx);
    } catch {
      await recordApiRequest({
        orgId: ctx.orgId,
        apiKeyId: ctx.apiKeyId,
        route: options.routeLabel,
        method,
        statusCode: 500,
        durationMs: Date.now() - startedAt,
      });
      return fail("Internal error while processing the request.", 500);
    }

    const durationMs = Date.now() - startedAt;

    // Record telemetry for every outcome. Meter the plan quota only when the
    // handler actually did billable work (2xx) so client errors don't burn quota.
    await recordApiRequest({
      orgId: ctx.orgId,
      apiKeyId: ctx.apiKeyId,
      route: options.routeLabel,
      method,
      statusCode: response.status,
      durationMs,
    });

    if (response.status >= 200 && response.status < 300) {
      await recordUsage(ctx.orgId, options.quotaKind, 1, {
        source: "api_v1",
        route: options.routeLabel,
        apiKeyId: ctx.apiKeyId,
      });
    }

    return response;
  };
}
