import type { Pool } from "pg";

// Postgres-backed memoization for the deterministic bio engines. Keyed by
// (source, cacheKey); a fresh row (within ttlMs) short-circuits the external API
// call. Everything degrades GRACEFULLY: any DB error just falls through to the
// live fetch, so caching can never break an engine — it only makes it faster and
// kinder to rate-limited public APIs. See db/migrations/0051_bio-cache.sql.

export type BioSource =
  | "open_targets"
  | "faers"
  | "chembl"
  | "gwas"
  | "clinvar"
  | "pharmgkb"
  | "pubtator";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — public reference facts change slowly.

async function readCache(
  pool: Pool,
  source: BioSource,
  cacheKey: string,
  ttlMs: number
): Promise<unknown | undefined> {
  try {
    const { rows } = await pool.query<{ payload: unknown; fetched_at: Date }>(
      `select payload, fetched_at from bio_cache where source = $1 and cache_key = $2`,
      [source, cacheKey]
    );
    if (rows.length === 0) return undefined;
    const ageMs = Date.now() - new Date(rows[0].fetched_at).getTime();
    if (ageMs > ttlMs) return undefined; // stale — re-fetch.
    return rows[0].payload;
  } catch {
    return undefined; // DB down / table missing → behave as a cache miss.
  }
}

async function writeCache(
  pool: Pool,
  source: BioSource,
  cacheKey: string,
  payload: unknown
): Promise<void> {
  try {
    await pool.query(
      `insert into bio_cache (source, cache_key, payload, fetched_at)
         values ($1, $2, $3, now())
         on conflict (source, cache_key)
         do update set payload = excluded.payload, fetched_at = now()`,
      [source, cacheKey, JSON.stringify(payload)]
    );
  } catch {
    // Non-fatal: a failed cache write must not affect the caller.
  }
}

/**
 * Return the cached bio result for (source, cacheKey) when fresh, otherwise call
 * `fetchFn`, cache its result, and return it. `null` results are NOT cached (an
 * honest empty from a transient API failure shouldn't be memoized as truth).
 * Pass a Pool to enable caching; without one it just runs `fetchFn` (e.g. tests).
 */
export async function cachedBio<T>(
  pool: Pool | undefined,
  source: BioSource,
  cacheKey: string,
  fetchFn: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<T> {
  if (!pool) return fetchFn();

  const hit = await readCache(pool, source, cacheKey, ttlMs);
  if (hit !== undefined) return hit as T;

  const fresh = await fetchFn();
  if (fresh !== null && fresh !== undefined) {
    await writeCache(pool, source, cacheKey, fresh);
  }
  return fresh;
}

/** Prune cache rows older than `maxAgeMs` (for a periodic sweep / cron tick). */
export async function pruneBioCache(pool: Pool, maxAgeMs: number = DEFAULT_TTL_MS): Promise<number> {
  try {
    const cutoffIso = new Date(Date.now() - maxAgeMs).toISOString();
    const { rowCount } = await pool.query(`delete from bio_cache where fetched_at < $1`, [cutoffIso]);
    return rowCount ?? 0;
  } catch {
    return 0;
  }
}
