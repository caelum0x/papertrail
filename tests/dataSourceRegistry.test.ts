import { describe, it, expect, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import {
  DATA_SOURCE_CATALOG,
  seedCatalog,
  upsertSource,
  listSources,
  recordAccess,
  getAccessLog,
} from "../lib/governance/dataSources";
import {
  catalogEntrySchema,
  dataSourceSchema,
  sourceAccessSchema,
} from "../lib/governance/dataSources.schemas";

// The DATA-SOURCE PROVENANCE REGISTRY runs fully OFFLINE here over an in-memory
// fake of the pg Pool. The contracts under test are the ones a regulated buyer
// cares about:
//   1. CATALOG INTEGRITY — the documented static catalog is well-formed and every
//      entry seeds into the registry.
//   2. ORG-SCOPED WRITES — recordAccess writes an append-only row carrying the
//      RESOLVED org_id (and bumps the source's last_accessed_at atomically).
//   3. TENANT ISOLATION — getAccessLog filters by org_id FIRST; one tenant never
//      sees another tenant's (or the platform-internal null-org) accesses.

// --- In-memory fake pg Pool -------------------------------------------------

interface SourceRow {
  id: string;
  source_key: string;
  display_name: string;
  database_version: string | null;
  license: string | null;
  url: string | null;
  last_accessed_at: Date | null;
  snapshot_date: string | null;
  created_at: Date;
}

interface AccessRow {
  id: string;
  source_key: string;
  org_id: string | null;
  purpose: string;
  accessed_at: Date;
}

interface Store {
  sources: Map<string, SourceRow>;
  accesses: AccessRow[];
}

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `00000000-0000-0000-0000-${String(idSeq).padStart(12, "0")}`;
}

// One query executor shared by the pool and its transaction client, so writes in
// a transaction are visible to reads (the fake has no real isolation, which is
// fine for these deterministic assertions).
function makeExec(store: Store) {
  return async (sql: string, params: unknown[] = []) => {
    const text = sql.replace(/\s+/g, " ").trim();

    if (text.startsWith("begin") || text.startsWith("commit") || text.startsWith("rollback")) {
      return { rows: [], rowCount: 0 };
    }

    if (text.includes("insert into evidence_data_sources")) {
      const [sourceKey, displayName, databaseVersion, license, url, snapshotDate] =
        params as (string | null)[];
      const existing = store.sources.get(sourceKey as string);
      const row: SourceRow = existing
        ? {
            ...existing,
            display_name: displayName as string,
            database_version:
              (databaseVersion as string | null) ?? existing.database_version,
            license: license as string | null,
            url: url as string | null,
            snapshot_date: (snapshotDate as string | null) ?? existing.snapshot_date,
          }
        : {
            id: nextId(),
            source_key: sourceKey as string,
            display_name: displayName as string,
            database_version: (databaseVersion as string | null) ?? null,
            license: license as string | null,
            url: url as string | null,
            last_accessed_at: null,
            snapshot_date: (snapshotDate as string | null) ?? null,
            created_at: new Date(),
          };
      store.sources.set(row.source_key, row);
      return { rows: [row], rowCount: 1 };
    }

    if (text.includes("select") && text.includes("from evidence_data_sources") && text.includes("order by display_name")) {
      const rows = [...store.sources.values()].sort((a, b) =>
        a.display_name.localeCompare(b.display_name)
      );
      return { rows, rowCount: rows.length };
    }

    if (text.includes("insert into evidence_source_accesses")) {
      const [sourceKey, orgId, purpose] = params as (string | null)[];
      const row: AccessRow = {
        id: nextId(),
        source_key: sourceKey as string,
        org_id: (orgId as string | null) ?? null,
        purpose: purpose as string,
        accessed_at: new Date(Date.now() + store.accesses.length),
      };
      store.accesses.push(row);
      return { rows: [row], rowCount: 1 };
    }

    if (text.includes("update evidence_data_sources") && text.includes("last_accessed_at")) {
      const sourceKey = params[0] as string;
      const src = store.sources.get(sourceKey);
      if (src) src.last_accessed_at = new Date();
      return { rows: [], rowCount: src ? 1 : 0 };
    }

    if (text.includes("from evidence_source_accesses") && text.includes("where org_id = $1")) {
      const orgId = params[0] as string;
      const limit = params[1] as number;
      // org_id is the FIRST predicate — the fake enforces the same isolation.
      const rows = store.accesses
        .filter((a) => a.org_id === orgId)
        .sort((a, b) => b.accessed_at.getTime() - a.accessed_at.getTime())
        .slice(0, limit);
      return { rows, rowCount: rows.length };
    }

    throw new Error(`Unhandled SQL in fake pool: ${text}`);
  };
}

function fakePool(store: Store): Pool {
  const exec = makeExec(store);
  const client = {
    query: vi.fn(exec),
    release: vi.fn(),
  } as unknown as PoolClient;
  return {
    query: vi.fn(exec),
    connect: vi.fn(async () => client),
  } as unknown as Pool;
}

// ---------------------------------------------------------------------------

describe("data-source catalog — documented reference facts", () => {
  it("every catalog entry is well-formed (valid license + url + source_key)", () => {
    expect(DATA_SOURCE_CATALOG.length).toBeGreaterThan(0);
    for (const entry of DATA_SOURCE_CATALOG) {
      expect(() => catalogEntrySchema.parse(entry)).not.toThrow();
    }
  });

  it("covers the platform's nine open sources with unique keys", () => {
    const keys = DATA_SOURCE_CATALOG.map((e) => e.sourceKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const expected of [
      "open_targets",
      "gwas_catalog",
      "clinvar",
      "chembl",
      "pharmgkb",
      "faers",
      "pubtator",
      "pubmed",
      "clinicaltrials",
    ]) {
      expect(keys).toContain(expected);
    }
  });
});

describe("seedCatalog / listSources — the registry is seeded", () => {
  it("seeds every catalog entry and lists them back, schema-valid", async () => {
    const store: Store = { sources: new Map(), accesses: [] };
    const pool = fakePool(store);

    const seeded = await seedCatalog(pool);
    expect(seeded.length).toBe(DATA_SOURCE_CATALOG.length);

    const listed = await listSources(pool);
    expect(listed.length).toBe(DATA_SOURCE_CATALOG.length);
    const listedKeys = new Set(listed.map((s) => s.sourceKey));
    for (const entry of DATA_SOURCE_CATALOG) {
      expect(listedKeys.has(entry.sourceKey)).toBe(true);
    }
    for (const source of listed) {
      expect(() => dataSourceSchema.parse(source)).not.toThrow();
    }
  });

  it("upsertSource is idempotent — re-seeding never duplicates a source_key", async () => {
    const store: Store = { sources: new Map(), accesses: [] };
    const pool = fakePool(store);

    await seedCatalog(pool);
    await seedCatalog(pool);

    const listed = await listSources(pool);
    expect(listed.length).toBe(DATA_SOURCE_CATALOG.length);
  });

  it("re-seeding does not clobber an operationally-set snapshot_date with null", async () => {
    const store: Store = { sources: new Map(), accesses: [] };
    const pool = fakePool(store);

    // Operator sets a concrete snapshot for open_targets.
    await upsertSource(pool, {
      ...DATA_SOURCE_CATALOG.find((e) => e.sourceKey === "open_targets")!,
      snapshotDate: "2026-06-01",
      databaseVersion: "24.06",
    });
    // A bare re-seed (snapshotDate null) must COALESCE, not overwrite.
    await seedCatalog(pool);

    const listed = await listSources(pool);
    const ot = listed.find((s) => s.sourceKey === "open_targets");
    expect(ot?.snapshotDate).toBe("2026-06-01");
    expect(ot?.databaseVersion).toBe("24.06");
  });
});

describe("recordAccess — org-scoped, append-only provenance writes", () => {
  it("writes an access row carrying the resolved org_id and bumps last_accessed_at", async () => {
    const store: Store = { sources: new Map(), accesses: [] };
    const pool = fakePool(store);
    await seedCatalog(pool);

    const orgId = "11111111-1111-1111-1111-111111111111";
    const access = await recordAccess(pool, "open_targets", orgId, "verify:claim-42");

    expect(() => sourceAccessSchema.parse(access)).not.toThrow();
    expect(access.orgId).toBe(orgId);
    expect(access.sourceKey).toBe("open_targets");
    expect(access.purpose).toBe("verify:claim-42");
    expect(store.accesses).toHaveLength(1);

    // last_accessed_at on the registry row was bumped in the same transaction.
    const listed = await listSources(pool);
    const ot = listed.find((s) => s.sourceKey === "open_targets");
    expect(ot?.lastAccessedAt).not.toBeNull();
  });

  it("accepts a null org_id for platform-internal accesses", async () => {
    const store: Store = { sources: new Map(), accesses: [] };
    const pool = fakePool(store);
    await seedCatalog(pool);

    const access = await recordAccess(pool, "faers", null, "internal:refresh");
    expect(access.orgId).toBeNull();
    expect(store.accesses).toHaveLength(1);
  });
});

describe("getAccessLog — filters by org_id FIRST (tenant isolation)", () => {
  it("returns only the caller org's accesses, never another tenant's or the null-org", async () => {
    const store: Store = { sources: new Map(), accesses: [] };
    const pool = fakePool(store);
    await seedCatalog(pool);

    const orgA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const orgB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    await recordAccess(pool, "open_targets", orgA, "verify:a1");
    await recordAccess(pool, "chembl", orgA, "verify:a2");
    await recordAccess(pool, "gwas_catalog", orgB, "verify:b1");
    await recordAccess(pool, "faers", null, "internal:refresh");

    const logA = await getAccessLog(pool, orgA);
    expect(logA).toHaveLength(2);
    expect(logA.every((a) => a.orgId === orgA)).toBe(true);

    const logB = await getAccessLog(pool, orgB);
    expect(logB).toHaveLength(1);
    expect(logB[0].orgId).toBe(orgB);
    expect(logB[0].sourceKey).toBe("gwas_catalog");
  });

  it("orders newest first and respects the limit", async () => {
    const store: Store = { sources: new Map(), accesses: [] };
    const pool = fakePool(store);
    await seedCatalog(pool);

    const org = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    await recordAccess(pool, "pubmed", org, "verify:1");
    await recordAccess(pool, "clinicaltrials", org, "verify:2");
    await recordAccess(pool, "clinvar", org, "verify:3");

    const limited = await getAccessLog(pool, org, 2);
    expect(limited).toHaveLength(2);
    // Newest first: the last-recorded access ("verify:3") comes first.
    expect(limited[0].purpose).toBe("verify:3");
    expect(limited[1].purpose).toBe("verify:2");
  });
});
