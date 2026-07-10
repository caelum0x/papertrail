import { describe, it, expect, vi } from "vitest";
import { cachedBio } from "../lib/bio/cache";
import type { Pool } from "pg";

// A tiny in-memory fake of the pg Pool.query surface used by the cache.
function fakePool(store: Map<string, { payload: unknown; fetched_at: Date }>): Pool {
  return {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes("select payload")) {
        const key = `${params[0]}|${params[1]}`;
        const row = store.get(key);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes("insert into bio_cache")) {
        store.set(`${params[0]}|${params[1]}`, {
          payload: JSON.parse(params[2] as string),
          fetched_at: new Date(),
        });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as Pool;
}

describe("cachedBio", () => {
  it("without a pool, just runs fetchFn (no caching)", async () => {
    const fetchFn = vi.fn(async () => ({ score: 0.9 }));
    const r = await cachedBio(undefined, "open_targets", "PCSK9|EFO", fetchFn);
    expect(r).toEqual({ score: 0.9 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("caches a successful result and serves the second call from cache", async () => {
    const store = new Map<string, { payload: unknown; fetched_at: Date }>();
    const pool = fakePool(store);
    const fetchFn = vi.fn(async () => ({ score: 0.9 }));

    const a = await cachedBio(pool, "open_targets", "PCSK9|EFO", fetchFn);
    const b = await cachedBio(pool, "open_targets", "PCSK9|EFO", fetchFn);

    expect(a).toEqual({ score: 0.9 });
    expect(b).toEqual({ score: 0.9 });
    expect(fetchFn).toHaveBeenCalledTimes(1); // second call hit the cache
  });

  it("does NOT cache a null result (transient empty stays re-fetchable)", async () => {
    const store = new Map<string, { payload: unknown; fetched_at: Date }>();
    const pool = fakePool(store);
    const fetchFn = vi.fn(async () => null);

    await cachedBio(pool, "faers", "drugX|eventY", fetchFn);
    await cachedBio(pool, "faers", "drugX|eventY", fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(2); // null never memoized
    expect(store.size).toBe(0);
  });

  it("re-fetches when the cached row is older than the TTL", async () => {
    const store = new Map<string, { payload: unknown; fetched_at: Date }>();
    store.set("chembl|CHEMBL25", { payload: { stale: true }, fetched_at: new Date(0) });
    const pool = fakePool(store);
    const fetchFn = vi.fn(async () => ({ fresh: true }));

    const r = await cachedBio(pool, "chembl", "CHEMBL25", fetchFn, 1000);
    expect(r).toEqual({ fresh: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
