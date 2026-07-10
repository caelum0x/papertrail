import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Tests for the enterprise API v1 gateway (withApiKey).
//
// Everything the gateway depends on is mocked so the test asserts control flow
// only, with no DB / network:
//   - the key store (pool.query against api_keys)
//   - billing quota (checkQuota / recordUsage)
//   - apiusage telemetry (recordApiRequest / recordRateLimitEvent)
//
// Assertions:
//   - 401 with no Authorization header
//   - 401 with an unknown/revoked key
//   - 200 + usage recorded with a valid key
//   - 429 over quota, with a rate-limit event recorded and NO usage burned
// ---------------------------------------------------------------------------

const query = vi.fn();
vi.mock("@/lib/db", () => ({
  getPool: () => ({ query }),
}));

// hashApiKey is deterministic in the real module; we only need a stable stub so
// the resolveKey lookup receives a predictable hash argument.
vi.mock("@/lib/admin-audit/apiKeys", () => ({
  hashApiKey: (raw: string) => `hash(${raw})`,
}));

const checkQuota = vi.fn();
const recordUsage = vi.fn();
vi.mock("@/lib/billing/usage", () => ({
  checkQuota: (...args: unknown[]) => checkQuota(...args),
  recordUsage: (...args: unknown[]) => recordUsage(...args),
}));

const recordApiRequest = vi.fn();
const recordRateLimitEvent = vi.fn();
vi.mock("@/lib/apiusage/record", () => ({
  recordApiRequest: (...args: unknown[]) => recordApiRequest(...args),
  recordRateLimitEvent: (...args: unknown[]) => recordRateLimitEvent(...args),
}));

import { withApiKey, type ApiCtx } from "@/lib/apiv1/gateway";
import { ok } from "@/lib/api/response";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const KEY_ID = "22222222-2222-2222-2222-222222222222";
const OPTS = { quotaKind: "verification", routeLabel: "/api/v1/test" };

function makeReq(headers?: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/v1/test", {
    method: "POST",
    headers,
  });
}

async function bodyOf(
  res: Response
): Promise<{ success: boolean; error: string | null; data: unknown }> {
  return (await res.json()) as {
    success: boolean;
    error: string | null;
    data: unknown;
  };
}

// A trivial handler that echoes the resolved org id — lets us assert the ctx the
// gateway passes through, and that a client never influences the org id.
function echoHandler() {
  return vi.fn(async (_req: NextRequest, ctx: ApiCtx) =>
    ok({ orgId: ctx.orgId, apiKeyId: ctx.apiKeyId })
  );
}

// Wire the key-store mock: `update ... last_used_at` and revocation/lookup all go
// through the single query() mock. `keyRow` null => unknown/revoked key.
function mockKeyStore(keyRow: { id: string; org_id: string } | null): void {
  query.mockImplementation((sql: string) => {
    if (/from api_keys/i.test(sql)) {
      return Promise.resolve({ rows: keyRow ? [keyRow] : [] });
    }
    // last_used_at update and anything else.
    return Promise.resolve({ rows: [] });
  });
}

describe("withApiKey", () => {
  beforeEach(() => {
    query.mockReset();
    checkQuota.mockReset();
    recordUsage.mockReset();
    recordApiRequest.mockReset();
    recordRateLimitEvent.mockReset();
  });

  it("rejects 401 when the Authorization header is absent", async () => {
    const handler = echoHandler();
    const route = withApiKey(handler, OPTS);

    const res = await route(makeReq());

    expect(res.status).toBe(401);
    expect((await bodyOf(res)).success).toBe(false);
    // No DB lookup, no quota check, no handler invocation.
    expect(query).not.toHaveBeenCalled();
    expect(checkQuota).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects 401 when the Authorization header is malformed (no Bearer)", async () => {
    const handler = echoHandler();
    const route = withApiKey(handler, OPTS);

    const res = await route(makeReq({ authorization: "pt_live_abc" }));

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects 401 for an unknown or revoked key", async () => {
    mockKeyStore(null);
    const handler = echoHandler();
    const route = withApiKey(handler, OPTS);

    const res = await route(makeReq({ authorization: "Bearer pt_live_bad" }));

    expect(res.status).toBe(401);
    // The store was consulted, but nothing billable ran.
    expect(query).toHaveBeenCalled();
    expect(checkQuota).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 200 and records usage for a valid key within quota", async () => {
    mockKeyStore({ id: KEY_ID, org_id: ORG_ID });
    checkQuota.mockResolvedValue({ allowed: true });
    const handler = echoHandler();
    const route = withApiKey(handler, OPTS);

    const res = await route(makeReq({ authorization: "Bearer pt_live_good" }));

    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.success).toBe(true);
    // Org id comes from the key row — never from the client.
    expect((body.data as { orgId: string }).orgId).toBe(ORG_ID);

    // Quota was checked BEFORE the handler ran, against the resolved org.
    expect(checkQuota).toHaveBeenCalledWith(ORG_ID, "verification", 1);
    expect(handler).toHaveBeenCalledTimes(1);

    // Usage metered once (200) and telemetry recorded.
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage.mock.calls[0][0]).toBe(ORG_ID);
    expect(recordUsage.mock.calls[0][1]).toBe("verification");
    expect(recordApiRequest).toHaveBeenCalledTimes(1);
    const telemetry = recordApiRequest.mock.calls[0][0] as {
      orgId: string;
      route: string;
      statusCode: number;
    };
    expect(telemetry.orgId).toBe(ORG_ID);
    expect(telemetry.route).toBe("/api/v1/test");
    expect(telemetry.statusCode).toBe(200);
    // No rate-limit event on a successful request.
    expect(recordRateLimitEvent).not.toHaveBeenCalled();
  });

  it("rejects 429 over quota, records a rate-limit event, and burns no usage", async () => {
    mockKeyStore({ id: KEY_ID, org_id: ORG_ID });
    checkQuota.mockResolvedValue({ allowed: false });
    const handler = echoHandler();
    const route = withApiKey(handler, OPTS);

    const res = await route(makeReq({ authorization: "Bearer pt_live_good" }));

    expect(res.status).toBe(429);
    expect((await bodyOf(res)).success).toBe(false);

    // The engine never ran and no billable usage was recorded.
    expect(handler).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();

    // A rate-limit event and a 429 telemetry row were recorded for the org.
    expect(recordRateLimitEvent).toHaveBeenCalledTimes(1);
    expect(recordRateLimitEvent.mock.calls[0][0]).toMatchObject({
      orgId: ORG_ID,
      apiKeyId: KEY_ID,
      route: "/api/v1/test",
    });
    expect(recordApiRequest).toHaveBeenCalledTimes(1);
    expect(
      (recordApiRequest.mock.calls[0][0] as { statusCode: number }).statusCode
    ).toBe(429);
  });

  it("meters no quota when the handler returns a client error (4xx)", async () => {
    mockKeyStore({ id: KEY_ID, org_id: ORG_ID });
    checkQuota.mockResolvedValue({ allowed: true });
    const handler = vi.fn(async () =>
      ok({ ignored: true })
    );
    // Force a 4xx by wrapping a handler that returns a failing envelope.
    const failing = withApiKey(
      async () =>
        new Response(
          JSON.stringify({ success: false, data: null, error: "bad input" }),
          { status: 400, headers: { "content-type": "application/json" } }
        ),
      OPTS
    );
    void handler;

    const res = await failing(makeReq({ authorization: "Bearer pt_live_good" }));

    expect(res.status).toBe(400);
    // Telemetry still recorded, but no billable usage burned on a 4xx.
    expect(recordApiRequest).toHaveBeenCalledTimes(1);
    expect(recordUsage).not.toHaveBeenCalled();
  });
});
