import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import {
  recordEngineUsage,
  summarizeUsage,
  meter,
} from "../lib/metering/engineUsage";

// A metered row as it lands in the fake engine_usage table.
interface UsageRow {
  org_id: string;
  engine: string;
  units: number;
  claude_tokens: number;
  occurred_at: Date;
}

// A tiny in-memory fake of the pg Pool.query surface the metering repo uses:
// an INSERT into engine_usage and a grouped SELECT summary. It faithfully
// enforces the org_id-first predicate and the optional occurred_at >= since
// filter, so tests exercise real org-scoping rather than a rubber stamp.
function fakePool(store: UsageRow[]): Pool {
  return {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes("insert into engine_usage")) {
        store.push({
          org_id: params[0] as string,
          engine: params[1] as string,
          units: params[2] as number,
          claude_tokens: params[3] as number,
          occurred_at: new Date(),
        });
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("from engine_usage") && sql.includes("group by engine")) {
        const orgId = params[0] as string;
        const since = params[1] ? new Date(params[1] as string) : null;

        // org_id is the first predicate — rows for other orgs are invisible.
        const scoped = store.filter(
          (r) =>
            r.org_id === orgId && (since === null || r.occurred_at >= since)
        );

        const byEngine = new Map<
          string,
          { calls: number; units: number; claude_tokens: number }
        >();
        for (const r of scoped) {
          const cur = byEngine.get(r.engine) ?? {
            calls: 0,
            units: 0,
            claude_tokens: 0,
          };
          byEngine.set(r.engine, {
            calls: cur.calls + 1,
            units: cur.units + r.units,
            claude_tokens: cur.claude_tokens + r.claude_tokens,
          });
        }

        const rows = [...byEngine.entries()]
          .map(([engine, agg]) => ({ engine, ...agg }))
          .sort((a, b) => b.units - a.units || a.engine.localeCompare(b.engine));
        return { rows, rowCount: rows.length };
      }

      return { rows: [], rowCount: 0 };
    }),
  } as unknown as Pool;
}

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";

describe("meter", () => {
  it("defaults to 1 unit and 0 tokens", () => {
    expect(meter()).toEqual({ units: 1, claudeTokens: 0 });
    expect(meter({})).toEqual({ units: 1, claudeTokens: 0 });
  });

  it("floors units to at least 1 and tokens to at least 0", () => {
    expect(meter({ units: 0, claudeTokens: -5 })).toEqual({
      units: 1,
      claudeTokens: 0,
    });
    expect(meter({ units: 3, claudeTokens: 250 })).toEqual({
      units: 3,
      claudeTokens: 250,
    });
  });

  it("truncates fractional inputs deterministically", () => {
    expect(meter({ units: 2.9, claudeTokens: 10.7 })).toEqual({
      units: 2,
      claudeTokens: 10,
    });
  });
});

describe("recordEngineUsage", () => {
  it("writes an org-scoped row with the given engine/units/tokens", async () => {
    const store: UsageRow[] = [];
    const pool = fakePool(store);

    await recordEngineUsage(pool, {
      orgId: ORG_A,
      engine: "meta_analysis",
      units: 2,
      claudeTokens: 512,
    });

    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({
      org_id: ORG_A,
      engine: "meta_analysis",
      units: 2,
      claude_tokens: 512,
    });
  });

  it("defaults units to 1 and claudeTokens to 0", async () => {
    const store: UsageRow[] = [];
    const pool = fakePool(store);

    await recordEngineUsage(pool, { orgId: ORG_A, engine: "faers" });

    expect(store[0]).toMatchObject({ units: 1, claude_tokens: 0 });
  });

  it("rejects a non-uuid org id and never writes a row", async () => {
    const store: UsageRow[] = [];
    const pool = fakePool(store);

    await expect(
      recordEngineUsage(pool, { orgId: "not-a-uuid", engine: "faers" })
    ).rejects.toThrow(/Invalid engine usage input/);
    expect(store).toHaveLength(0);
  });

  it("rejects negative units and never writes a row", async () => {
    const store: UsageRow[] = [];
    const pool = fakePool(store);

    await expect(
      recordEngineUsage(pool, { orgId: ORG_A, engine: "faers", units: -1 })
    ).rejects.toThrow(/Invalid engine usage input/);
    expect(store).toHaveLength(0);
  });
});

describe("summarizeUsage", () => {
  it("aggregates per engine: call counts, unit totals, token totals", async () => {
    const store: UsageRow[] = [];
    const pool = fakePool(store);

    await recordEngineUsage(pool, {
      orgId: ORG_A,
      engine: "meta_analysis",
      units: 1,
      claudeTokens: 100,
    });
    await recordEngineUsage(pool, {
      orgId: ORG_A,
      engine: "meta_analysis",
      units: 2,
      claudeTokens: 300,
    });
    await recordEngineUsage(pool, {
      orgId: ORG_A,
      engine: "faers",
      units: 1,
      claudeTokens: 0,
    });

    const summary = await summarizeUsage(pool, { orgId: ORG_A });

    const meta = summary.engines.find((e) => e.engine === "meta_analysis");
    const faers = summary.engines.find((e) => e.engine === "faers");

    expect(meta).toEqual({
      engine: "meta_analysis",
      calls: 2,
      units: 3,
      claudeTokens: 400,
    });
    expect(faers).toEqual({
      engine: "faers",
      calls: 1,
      units: 1,
      claudeTokens: 0,
    });
    expect(summary.totals).toEqual({ calls: 3, units: 4, claudeTokens: 400 });
  });

  it("is org-scoped: never counts another org's usage", async () => {
    const store: UsageRow[] = [];
    const pool = fakePool(store);

    await recordEngineUsage(pool, {
      orgId: ORG_A,
      engine: "meta_analysis",
      units: 5,
      claudeTokens: 900,
    });
    await recordEngineUsage(pool, {
      orgId: ORG_B,
      engine: "meta_analysis",
      units: 99,
      claudeTokens: 99_999,
    });

    const summary = await summarizeUsage(pool, { orgId: ORG_A });

    expect(summary.engines).toHaveLength(1);
    expect(summary.totals).toEqual({ calls: 1, units: 5, claudeTokens: 900 });
  });

  it("returns empty engines and zero totals when the org has no usage", async () => {
    const store: UsageRow[] = [];
    const pool = fakePool(store);

    const summary = await summarizeUsage(pool, { orgId: ORG_A });

    expect(summary.engines).toEqual([]);
    expect(summary.totals).toEqual({ calls: 0, units: 0, claudeTokens: 0 });
  });

  it("orders engines heaviest-first by units", async () => {
    const store: UsageRow[] = [];
    const pool = fakePool(store);

    await recordEngineUsage(pool, { orgId: ORG_A, engine: "light", units: 1 });
    await recordEngineUsage(pool, { orgId: ORG_A, engine: "heavy", units: 10 });

    const summary = await summarizeUsage(pool, { orgId: ORG_A });

    expect(summary.engines.map((e) => e.engine)).toEqual(["heavy", "light"]);
  });

  it("honors the `since` window", async () => {
    const store: UsageRow[] = [];
    const pool = fakePool(store);

    // An old row placed before the cutoff, and a fresh one after it.
    const old = new Date(Date.now() - 60 * 60 * 1000);
    store.push({
      org_id: ORG_A,
      engine: "faers",
      units: 7,
      claude_tokens: 0,
      occurred_at: old,
    });
    await recordEngineUsage(pool, { orgId: ORG_A, engine: "faers", units: 1 });

    const since = new Date(Date.now() - 30 * 60 * 1000);
    const summary = await summarizeUsage(pool, { orgId: ORG_A, since });

    expect(summary.totals.units).toBe(1);
    expect(summary.totals.calls).toBe(1);
  });
});
