import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// The /api/verify route wires together retrieval, extraction, verification, the
// deterministic checks, and best-effort persistence. These integration tests mock
// only the *boundaries* (network/LLM agents + DB) and exercise the real request
// validation, rate limiting, mock-mode branch, and response-envelope assembly.

const retrieveSources = vi.fn();
const extractFinding = vi.fn();
const verifyClaim = vi.fn();
const reconcile = vi.fn();
const checkAgainstRegistry = vi.fn();
const query = vi.fn();

vi.mock("@/lib/agents/retrievalAgent", () => ({
  retrieveSources: (...a: unknown[]) => retrieveSources(...a),
}));
vi.mock("@/lib/agents/extractionAgent", () => ({
  extractFinding: (...a: unknown[]) => extractFinding(...a),
}));
vi.mock("@/lib/agents/verificationAgent", () => ({
  verifyClaim: (...a: unknown[]) => verifyClaim(...a),
}));
vi.mock("@/lib/effectSize", () => ({
  reconcile: (...a: unknown[]) => reconcile(...a),
}));
vi.mock("@/lib/structuredVerification", () => ({
  checkAgainstRegistry: (...a: unknown[]) => checkAgainstRegistry(...a),
}));
vi.mock("@/lib/db", () => ({
  getPool: () => ({ query }),
}));
vi.mock("@/lib/logger", () => ({
  logEvent: () => undefined,
}));

// Unique IP per request keeps the shared in-memory rate-limit buckets isolated
// between tests (except the dedicated rate-limit test, which reuses one IP).
function makeReq(body: unknown, ip = `ip-${Math.random()}`, raw = false): NextRequest {
  return new NextRequest("http://localhost/api/verify", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

async function loadRoute(mockMode: boolean) {
  vi.resetModules();
  process.env.MOCK_MODE = mockMode ? "true" : "false";
  process.env.RATE_LIMIT_MAX = "10";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
  return await import("@/app/api/verify/route");
}

function sourceFixture() {
  return {
    id: "src-1",
    title: "Trial X",
    url: "https://example.org/x",
    source_type: "pubmed",
    external_id: "12345",
    phase: null,
    enrollment_count: null,
    raw_text: "Drug X reduced events. difference, -0.45.",
    registered_results: [],
  };
}

beforeEach(() => {
  retrieveSources.mockReset();
  extractFinding.mockReset();
  verifyClaim.mockReset();
  reconcile.mockReset();
  checkAgainstRegistry.mockReset();
  query.mockReset();

  reconcile.mockReturnValue({ verdict: "defer" });
  extractFinding.mockResolvedValue({ endpoint: "primary" });
  verifyClaim.mockResolvedValue({
    discrepancy_type: "accurate",
    trust_score: 90,
    explanation: "matches",
    flagged_spans: [],
    grounding_dropped_count: 0,
    cross_source_agreement: "single_source",
  });
});

afterEach(() => {
  delete process.env.MOCK_MODE;
});

describe("POST /api/verify — live mode", () => {
  it("returns a verified envelope for a valid claim", async () => {
    const { POST } = await loadRoute(false);
    retrieveSources.mockResolvedValue([sourceFixture()]);
    query.mockResolvedValue({ rows: [{ id: "verif-1" }] });

    const res = await POST(makeReq({ claim: "Drug X reduced events by 30%." }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("verified");
    expect(body.verification_id).toBe("verif-1");
    expect(body.source.title).toBe("Trial X");
    expect(body.verification.discrepancy_type).toBe("accurate");
  });

  it("rejects a claim shorter than 10 characters with 400", async () => {
    const { POST } = await loadRoute(false);
    const res = await POST(makeReq({ claim: "short" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at least 10 characters/);
  });

  it("rejects a claim longer than 2000 characters with 400", async () => {
    const { POST } = await loadRoute(false);
    const res = await POST(makeReq({ claim: "a".repeat(2001) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too long/);
  });

  it("returns 400 for malformed JSON", async () => {
    const { POST } = await loadRoute(false);
    const res = await POST(makeReq("{not valid json", `ip-${Math.random()}`, true));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/valid JSON/);
  });

  it("returns no_support_found when retrieval finds no confident source", async () => {
    const { POST } = await loadRoute(false);
    retrieveSources.mockResolvedValue([]);
    const res = await POST(makeReq({ claim: "An utterly unverifiable clinical claim." }));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("no_support_found");
  });

  it("still returns 200 with verification_id null when persistence fails", async () => {
    const { POST } = await loadRoute(false);
    retrieveSources.mockResolvedValue([sourceFixture()]);
    query.mockRejectedValue(new Error("Neon connection reset"));

    const res = await POST(makeReq({ claim: "Drug X reduced events by 30%." }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("verified");
    expect(body.verification_id).toBeNull();
  });

  it("returns 429 once the rate limit for an IP is exceeded", async () => {
    const { POST } = await loadRoute(false);
    retrieveSources.mockResolvedValue([]);
    const ip = `rate-${Math.random()}`;
    // RATE_LIMIT_MAX=10 → 10 allowed, 11th blocked.
    for (let i = 0; i < 10; i++) {
      await POST(makeReq({ claim: "A repeated but valid claim string." }, ip));
    }
    const res = await POST(makeReq({ claim: "A repeated but valid claim string." }, ip));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/Rate limit/);
  });

  it("passes the parsed source hint id to retrieval (NCT hint)", async () => {
    const { POST } = await loadRoute(false);
    retrieveSources.mockResolvedValue([sourceFixture()]);
    query.mockResolvedValue({ rows: [{ id: "verif-1" }] });

    await POST(
      makeReq({ claim: "Drug X reduced events by 30%.", source_hint: "NCT01234567" })
    );
    expect(retrieveSources).toHaveBeenCalledWith(
      expect.any(String),
      { preferExternalId: "NCT01234567" }
    );
  });
});

describe("POST /api/verify — mock mode", () => {
  it("answers a known demo claim from fixtures without hitting agents", async () => {
    const { POST } = await loadRoute(true);
    const res = await POST(makeReq({ claim: "lecanemab slowed cognitive decline by 27%." }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("verified");
    expect(retrieveSources).not.toHaveBeenCalled();
  });

  it("answers no_support_found for an unknown claim in mock mode", async () => {
    const { POST } = await loadRoute(true);
    const res = await POST(makeReq({ claim: "Some claim not in the demo fixtures at all." }));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("no_support_found");
  });
});
