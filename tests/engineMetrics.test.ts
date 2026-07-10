import { describe, it, expect, beforeEach } from "vitest";
import {
  recordEngineCall,
  engineSlaSummary,
  resetEngineMetrics,
  withEngineMetrics,
  WINDOW_SIZE,
} from "../lib/obsv/engineMetrics";

// Each test starts from a clean in-memory registry so percentiles are computed
// over exactly the samples the test feeds in — fully deterministic.
beforeEach(() => {
  resetEngineMetrics();
});

describe("recordEngineCall + engineSlaSummary", () => {
  it("computes exact nearest-rank p50/p95/p99 and errorRate for a fixed sequence", () => {
    // 10 calls, latencies 10..100; two calls (30ms, 70ms) marked as failures.
    const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const failures = new Set([30, 70]);
    for (const latencyMs of latencies) {
      recordEngineCall({ engine: "retrieval", latencyMs, ok: !failures.has(latencyMs) });
    }

    const summary = engineSlaSummary();
    expect(summary.windowSize).toBe(WINDOW_SIZE);
    expect(summary.engines).toHaveLength(1);

    const sla = summary.engines[0];
    expect(sla.engine).toBe("retrieval");
    expect(sla.calls).toBe(10);
    expect(sla.errors).toBe(2);
    expect(sla.errorRate).toBe(0.2);
    expect(sla.availability).toBe(0.8);
    // nearest-rank: p50 -> rank ceil(0.5*10)=5 -> 5th smallest = 50
    expect(sla.p50).toBe(50);
    // p95 -> rank ceil(0.95*10)=10 -> 10th smallest = 100
    expect(sla.p95).toBe(100);
    // p99 -> rank ceil(0.99*10)=10 -> 100
    expect(sla.p99).toBe(100);
    expect(sla.maxLatencyMs).toBe(100);
  });

  it("handles a single failed call: all percentiles equal that sample, errorRate 1", () => {
    recordEngineCall({ engine: "extraction", latencyMs: 42, ok: false });

    const sla = engineSlaSummary().engines[0];
    expect(sla.calls).toBe(1);
    expect(sla.errors).toBe(1);
    expect(sla.errorRate).toBe(1);
    expect(sla.availability).toBe(0);
    expect(sla.p50).toBe(42);
    expect(sla.p95).toBe(42);
    expect(sla.p99).toBe(42);
    expect(sla.maxLatencyMs).toBe(42);
  });

  it("computes percentiles independently per engine and sorts engines by name", () => {
    // verification: 4 calls 100,200,300,400 all ok
    for (const latencyMs of [100, 200, 300, 400]) {
      recordEngineCall({ engine: "verification", latencyMs, ok: true });
    }
    // bio: 5 calls 5,10,15,20,25 with one failure
    recordEngineCall({ engine: "bio", latencyMs: 5, ok: true });
    recordEngineCall({ engine: "bio", latencyMs: 10, ok: false });
    recordEngineCall({ engine: "bio", latencyMs: 15, ok: true });
    recordEngineCall({ engine: "bio", latencyMs: 20, ok: true });
    recordEngineCall({ engine: "bio", latencyMs: 25, ok: true });

    const engines = engineSlaSummary().engines;
    expect(engines.map((e) => e.engine)).toEqual(["bio", "verification"]);

    const bio = engines[0];
    expect(bio.calls).toBe(5);
    expect(bio.errorRate).toBe(0.2);
    // p50 -> rank ceil(0.5*5)=3 -> 3rd smallest of [5,10,15,20,25] = 15
    expect(bio.p50).toBe(15);
    // p95 -> rank ceil(0.95*5)=ceil(4.75)=5 -> 25
    expect(bio.p95).toBe(25);

    const verification = engines[1];
    expect(verification.errorRate).toBe(0);
    expect(verification.availability).toBe(1);
    // p50 -> rank ceil(0.5*4)=2 -> 2nd smallest of [100,200,300,400] = 200
    expect(verification.p50).toBe(200);
    // p95 -> rank ceil(0.95*4)=ceil(3.8)=4 -> 400
    expect(verification.p95).toBe(400);
  });

  it("bounds the buffer to WINDOW_SIZE, keeping only the most-recent calls", () => {
    // Feed WINDOW_SIZE fast calls, then WINDOW_SIZE slow calls. Only the slow
    // ones should remain, so p50 reflects the slow batch, not the fast one.
    for (let i = 0; i < WINDOW_SIZE; i += 1) {
      recordEngineCall({ engine: "graph", latencyMs: 1, ok: true });
    }
    for (let i = 0; i < WINDOW_SIZE; i += 1) {
      recordEngineCall({ engine: "graph", latencyMs: 1000, ok: true });
    }

    const sla = engineSlaSummary().engines[0];
    expect(sla.calls).toBe(WINDOW_SIZE);
    expect(sla.p50).toBe(1000);
    expect(sla.maxLatencyMs).toBe(1000);
  });

  it("drops invalid calls without throwing (never trusts unbounded input)", () => {
    recordEngineCall({ engine: "retrieval", latencyMs: 50, ok: true });
    // Invalid: negative latency, empty engine, non-finite — all rejected.
    recordEngineCall({ engine: "retrieval", latencyMs: -1, ok: true });
    recordEngineCall({ engine: "", latencyMs: 50, ok: true });
    recordEngineCall({
      engine: "retrieval",
      latencyMs: Number.POSITIVE_INFINITY,
      ok: true,
    });

    const engines = engineSlaSummary().engines;
    expect(engines).toHaveLength(1);
    expect(engines[0].calls).toBe(1);
    expect(engines[0].p50).toBe(50);
  });

  it("returns an empty engine list before any calls are recorded", () => {
    const summary = engineSlaSummary();
    expect(summary.engines).toEqual([]);
    expect(summary.windowSize).toBe(WINDOW_SIZE);
    expect(typeof summary.generatedAt).toBe("string");
  });
});

describe("withEngineMetrics", () => {
  it("records a successful call as ok and returns the result", async () => {
    const result = await withEngineMetrics("extraction", async () => "value");
    expect(result).toBe("value");

    const sla = engineSlaSummary().engines[0];
    expect(sla.engine).toBe("extraction");
    expect(sla.calls).toBe(1);
    expect(sla.errors).toBe(0);
    expect(sla.errorRate).toBe(0);
  });

  it("records a thrown call as an error and re-throws the original error", async () => {
    const boom = new Error("engine failed");
    await expect(
      withEngineMetrics("verification", async () => {
        throw boom;
      })
    ).rejects.toBe(boom);

    const sla = engineSlaSummary().engines[0];
    expect(sla.calls).toBe(1);
    expect(sla.errors).toBe(1);
    expect(sla.errorRate).toBe(1);
    expect(sla.availability).toBe(0);
  });
});
