import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit tests for the evidence-lifecycle webhook emitter. We mock the EXISTING
// webhook subsystem (lib/webhooks/dispatch + lib/webhooks/repository) and the pg
// pool so no HTTP or DB is touched. The invariants under test:
//   1. emitEvidenceEvent fans out ONLY to matching subscriptions (it delegates to
//      the existing dispatch, keyed by the exact event type), and reports the
//      matched-subscription count from the org-scoped repo.
//   2. The payload NEVER leaks claim text — unknown fields (including anything
//      that looks like claim content) are stripped before dispatch and logging.
//   3. The event is recorded in the org-scoped evidence_events log, and the emit
//      never throws even if dispatch or logging fails.

const dispatchEventMock = vi.fn();
const listActiveWebhooksForEventMock = vi.fn();

vi.mock("@/lib/webhooks/dispatch", () => ({
  dispatchEvent: dispatchEventMock,
}));

vi.mock("@/lib/webhooks/repository", () => ({
  listActiveWebhooksForEvent: listActiveWebhooksForEventMock,
}));

// Import AFTER mocks are registered.
const { emitEvidenceEvent, listEvidenceEvents } = await import(
  "@/lib/events/evidenceEvents"
);
const { EVIDENCE_EVENT_TYPES } = await import(
  "@/lib/events/evidenceEvents.schemas"
);

const ORG = "11111111-1111-1111-1111-111111111111";

// A fake pool that records every insert so tests can assert on the logged row.
interface Captured {
  sql: string;
  params: unknown[];
}

function makePool(): { pool: any; captured: Captured[] } {
  const captured: Captured[] = [];
  const pool = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      captured.push({ sql, params });
      if (/count\(\*\)/.test(sql)) return { rows: [{ n: 0 }] };
      return { rows: [] };
    }),
  };
  return { pool, captured };
}

function dispatchResult(over: Partial<{ delivered: number; failed: number }> = {}) {
  return {
    event: "evidence.verified",
    attempted: over.delivered ?? 0,
    delivered: over.delivered ?? 0,
    failed: over.failed ?? 0,
  };
}

beforeEach(() => {
  dispatchEventMock.mockReset();
  listActiveWebhooksForEventMock.mockReset();
});

describe("emitEvidenceEvent", () => {
  it("catalogue lists exactly the four evidence lifecycle events", () => {
    expect([...EVIDENCE_EVENT_TYPES]).toEqual([
      "evidence.verified",
      "dossier.built",
      "dossier.published",
      "signal.detected",
    ]);
  });

  it("fans out to matching subscriptions and reports counts", async () => {
    const { pool } = makePool();
    listActiveWebhooksForEventMock.mockResolvedValue([
      { id: "wh1", url: "https://a.example/hook", secret: "s" },
      { id: "wh2", url: "https://b.example/hook", secret: "s" },
    ]);
    dispatchEventMock.mockResolvedValue(dispatchResult({ delivered: 2, failed: 0 }));

    const res = await emitEvidenceEvent(pool, ORG, {
      type: "evidence.verified",
      entityType: "verification",
      entityId: "ver-123",
      data: { verdict: "supported", trust_score: 0.91 },
    });

    // matched comes from the org-scoped subscription lookup, keyed by event type.
    expect(listActiveWebhooksForEventMock).toHaveBeenCalledWith(
      pool,
      ORG,
      "evidence.verified"
    );
    // dispatch is delegated to the EXISTING subsystem with the same event type.
    expect(dispatchEventMock).toHaveBeenCalledTimes(1);
    const [orgArg, eventArg] = dispatchEventMock.mock.calls[0];
    expect(orgArg).toBe(ORG);
    expect(eventArg).toBe("evidence.verified");

    expect(res).toMatchObject({
      ok: true,
      eventType: "evidence.verified",
      matched: 2,
      delivered: 2,
      failed: 0,
      logged: true,
    });
  });

  it("does NOT enqueue when no subscription matches, but still logs the emit", async () => {
    const { pool, captured } = makePool();
    listActiveWebhooksForEventMock.mockResolvedValue([]);
    dispatchEventMock.mockResolvedValue(dispatchResult({ delivered: 0, failed: 0 }));

    const res = await emitEvidenceEvent(pool, ORG, {
      type: "signal.detected",
      entityType: "signal",
      entityId: "sig-9",
      data: { signal_kind: "disproportionality", severity: "high" },
    });

    expect(res.matched).toBe(0);
    expect(res.delivered).toBe(0);
    // dispatchEvent (the existing subsystem) is a no-op when no target matches; we
    // still delegate to it, and it returns zero — no delivery is enqueued.
    const inserts = captured.filter((c) => /insert into evidence_events/.test(c.sql));
    expect(inserts).toHaveLength(1);
    // Every persisted row is org-scoped: org_id is the first bound parameter.
    expect(inserts[0].params[0]).toBe(ORG);
    expect(res.logged).toBe(true);
  });

  it("strips claim text from the dispatched payload AND the logged row", async () => {
    const { pool, captured } = makePool();
    listActiveWebhooksForEventMock.mockResolvedValue([
      { id: "wh1", url: "https://a.example/hook", secret: "s" },
    ]);
    dispatchEventMock.mockResolvedValue(dispatchResult({ delivered: 1, failed: 0 }));

    const CLAIM = "Drug X reduced cardiovascular events by 30% in high-risk adults";

    // Attempt to smuggle claim content through several plausible keys that are
    // NOT in the whitelist schema. Cast to the input type so the test can express
    // a hostile caller; the runtime schema is what must strip these.
    await emitEvidenceEvent(pool, ORG, {
      type: "evidence.verified",
      entityType: "verification",
      entityId: "ver-42",
      data: {
        verdict: "contradicted",
        claim: CLAIM,
        claim_text: CLAIM,
        raw_text: CLAIM,
        text: CLAIM,
      },
    } as unknown as Parameters<typeof emitEvidenceEvent>[2]);

    // 1) Nothing claim-shaped reached the dispatch payload.
    const dispatchPayload = dispatchEventMock.mock.calls[0][2];
    const dispatchJson = JSON.stringify(dispatchPayload);
    expect(dispatchJson).not.toContain(CLAIM);
    expect(dispatchJson).not.toContain("reduced cardiovascular");
    // The permitted metadata still comes through.
    expect(dispatchPayload).toMatchObject({
      entity_type: "verification",
      entity_id: "ver-42",
      verdict: "contradicted",
    });
    expect(dispatchPayload).not.toHaveProperty("claim");
    expect(dispatchPayload).not.toHaveProperty("raw_text");

    // 2) Nothing claim-shaped reached the persisted evidence_events row.
    const insert = captured.find((c) => /insert into evidence_events/.test(c.sql));
    expect(insert).toBeDefined();
    const persistedJson = JSON.stringify(insert!.params);
    expect(persistedJson).not.toContain(CLAIM);
    // The data param is a JSON string with only whitelisted fields.
    const dataParam = insert!.params[4] as string;
    const dataObj = JSON.parse(dataParam);
    expect(dataObj).toEqual({ verdict: "contradicted" });
  });

  it("never throws and returns a zeroed result when dispatch fails", async () => {
    const { pool } = makePool();
    listActiveWebhooksForEventMock.mockResolvedValue([
      { id: "wh1", url: "https://a.example/hook", secret: "s" },
    ]);
    dispatchEventMock.mockRejectedValue(new Error("network down"));

    const res = await emitEvidenceEvent(pool, ORG, {
      type: "dossier.published",
      entityType: "dossier",
      entityId: "dos-1",
      data: { dossier_id: "dos-1", version: 3 },
    });

    expect(res.ok).toBe(false);
    expect(res.matched).toBe(0);
    expect(res.delivered).toBe(0);
    expect(res.failed).toBe(0);
    expect(res.logged).toBe(false);
  });

  it("rejects an unknown event type without throwing", async () => {
    const { pool } = makePool();
    const res = await emitEvidenceEvent(pool, ORG, {
      // @ts-expect-error — not a member of the event catalogue.
      type: "evidence.exploded",
      entityType: "verification",
      entityId: "ver-1",
    });
    expect(res.ok).toBe(false);
    // No subscription lookup / dispatch happens for invalid input.
    expect(listActiveWebhooksForEventMock).not.toHaveBeenCalled();
    expect(dispatchEventMock).not.toHaveBeenCalled();
  });
});

describe("listEvidenceEvents", () => {
  it("is org-scoped: org_id is always the first predicate, newest first", async () => {
    const now = new Date();
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        expect(sql).toMatch(/where org_id = \$1/);
        expect(sql).toMatch(/order by created_at desc/);
        expect(params[0]).toBe(ORG);
        return {
          rows: [
            {
              id: "ev1",
              event_type: "evidence.verified",
              entity_type: "verification",
              entity_id: "ver-1",
              // A row that somehow contains an unexpected field is re-sanitized
              // on read so the log API can never surface claim text.
              data: { verdict: "supported", claim: "should not surface" },
              matched: 2,
              delivered: 2,
              failed: 0,
              created_at: now,
            },
          ],
        };
      }),
    } as any;

    const events = await listEvidenceEvents(pool, ORG, { limit: 20, offset: 0 });
    expect(events).toHaveLength(1);
    expect(events[0].data).toEqual({ verdict: "supported" });
    expect(JSON.stringify(events[0])).not.toContain("should not surface");
  });

  it("applies an optional event_type filter as an additional org-scoped predicate", async () => {
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        expect(sql).toMatch(/org_id = \$1/);
        expect(sql).toMatch(/event_type = \$2/);
        expect(params[0]).toBe(ORG);
        expect(params[1]).toBe("signal.detected");
        return { rows: [] };
      }),
    } as any;

    await listEvidenceEvents(pool, ORG, {
      limit: 10,
      offset: 0,
      eventType: "signal.detected",
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
