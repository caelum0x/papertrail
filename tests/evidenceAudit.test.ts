import { describe, it, expect } from "vitest";
import type { Pool, PoolClient } from "pg";
import {
  appendEvidenceAudit,
  verifyEvidenceChain,
  listEvidenceAudit,
  computeLinkHash,
  GENESIS_PREV_HASH,
  type EvidenceAuditLink,
} from "@/lib/governance/evidenceAudit";

// A stateful in-memory mock of the pg Pool/PoolClient surface used by the
// evidence audit chain. It stores rows in a plain array and routes queries by
// the SQL text the repository actually runs (matching the real module, not a
// stub). This lets us exercise the true hash-chaining and verification logic —
// including tampering with a stored row — without a live Postgres.
interface Stored {
  id: string;
  org_id: string;
  seq: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor: string | null;
  payload: Record<string, unknown>;
  prev_hash: string;
  hash: string;
  created_at: Date;
}

function makePool() {
  const rows: Stored[] = [];
  let idCounter = 0;

  async function query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    // Transaction control is a no-op for the in-memory store.
    if (/^\s*(begin|commit|rollback)\s*$/i.test(sql)) {
      return { rows: [] };
    }

    // lockHead: head of an org's chain, highest seq first.
    if (sql.includes("select seq, hash") && sql.includes("for update")) {
      const orgId = params[0] as string;
      const head = rows
        .filter((r) => r.org_id === orgId)
        .sort((a, b) => b.seq - a.seq)[0];
      return { rows: head ? [{ seq: head.seq, hash: head.hash }] : [] };
    }

    // insert ... returning
    if (sql.includes("insert into evidence_audit_chain")) {
      const [
        org_id,
        seq,
        action,
        entity_type,
        entity_id,
        actor,
        payloadJson,
        prev_hash,
        hash,
      ] = params as [
        string,
        number,
        string,
        string,
        string | null,
        string | null,
        string,
        string,
        string,
      ];
      idCounter += 1;
      const stored: Stored = {
        id: `link-${idCounter}`,
        org_id,
        seq,
        action,
        entity_type,
        entity_id,
        actor,
        payload: JSON.parse(payloadJson) as Record<string, unknown>,
        prev_hash,
        hash,
        created_at: new Date("2026-07-10T00:00:00Z"),
      };
      rows.push(stored);
      return { rows: [{ ...stored }] };
    }

    // count(*) for a page
    if (sql.includes("count(*)::int as total")) {
      const orgId = params[0] as string;
      const total = rows.filter((r) => r.org_id === orgId).length;
      return { rows: [{ total }] };
    }

    // listEvidenceAudit: newest first with limit/offset
    if (sql.includes("order by seq desc") && sql.includes("limit")) {
      const [orgId, limit, offset] = params as [string, number, number];
      const page = rows
        .filter((r) => r.org_id === orgId)
        .sort((a, b) => b.seq - a.seq)
        .slice(offset, offset + limit)
        .map((r) => ({ ...r }));
      return { rows: page };
    }

    // verifyEvidenceChain: full chain oldest first
    if (sql.includes("order by seq asc")) {
      const orgId = params[0] as string;
      const chain = rows
        .filter((r) => r.org_id === orgId)
        .sort((a, b) => a.seq - b.seq)
        .map((r) => ({ ...r }));
      return { rows: chain };
    }

    throw new Error(`unexpected sql: ${sql}`);
  }

  const client = {
    query,
    release: () => undefined,
  } as unknown as PoolClient;

  const pool = {
    query,
    connect: async () => client,
  } as unknown as Pool;

  // Test-only accessor to mutate stored rows and simulate tampering.
  return { pool, rows };
}

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER_ORG = "22222222-2222-2222-2222-222222222222";
const ACTOR = "33333333-3333-3333-3333-333333333333";

async function appendThree(pool: Pool, orgId: string): Promise<EvidenceAuditLink[]> {
  const a = await appendEvidenceAudit(pool, orgId, {
    action: "dossier.built",
    entityType: "dossier",
    entityId: "d-1",
    actor: ACTOR,
    payload: { title: "Drug X efficacy" },
  });
  const b = await appendEvidenceAudit(pool, orgId, {
    action: "claim.verified",
    entityType: "claim",
    entityId: "c-1",
    actor: ACTOR,
    payload: { verdict: "supported", score: 0.9 },
  });
  const c = await appendEvidenceAudit(pool, orgId, {
    action: "approval.signed",
    entityType: "signature",
    entityId: "s-1",
    payload: {},
  });
  return [a, b, c];
}

describe("appendEvidenceAudit", () => {
  it("assigns dense per-org seq starting at 1 and chains each hash to the prior link", async () => {
    const { pool } = makePool();
    const [a, b, c] = await appendThree(pool, ORG);

    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);

    // Genesis link chains off the empty prev hash.
    expect(a.prevHash).toBe(GENESIS_PREV_HASH);
    // Each subsequent prev_hash is the previous link's hash.
    expect(b.prevHash).toBe(a.hash);
    expect(c.prevHash).toBe(b.hash);

    // Each stored hash recomputes from prev_hash + canonical(entry).
    expect(a.hash).toBe(
      computeLinkHash(GENESIS_PREV_HASH, {
        seq: 1,
        action: "dossier.built",
        entityType: "dossier",
        entityId: "d-1",
        actor: ACTOR,
        payload: { title: "Drug X efficacy" },
      })
    );
  });

  it("hashes payloads order-independently (canonical key sorting)", async () => {
    const h1 = computeLinkHash(GENESIS_PREV_HASH, {
      seq: 1,
      action: "x",
      entityType: "t",
      entityId: null,
      actor: null,
      payload: { a: 1, b: { c: 2, d: 3 } },
    });
    const h2 = computeLinkHash(GENESIS_PREV_HASH, {
      seq: 1,
      action: "x",
      entityType: "t",
      entityId: null,
      actor: null,
      payload: { b: { d: 3, c: 2 }, a: 1 },
    });
    expect(h1).toBe(h2);
  });

  it("rejects invalid input before anything is hashed or stored", async () => {
    const { pool, rows } = makePool();
    await expect(
      appendEvidenceAudit(pool, ORG, {
        // empty action fails the schema
        action: "",
        entityType: "dossier",
        payload: {},
      })
    ).rejects.toThrow();
    expect(rows).toHaveLength(0);
  });

  it("requires an orgId", async () => {
    const { pool } = makePool();
    await expect(
      appendEvidenceAudit(pool, "", {
        action: "x",
        entityType: "t",
        payload: {},
      })
    ).rejects.toThrow(/orgId/);
  });
});

describe("verifyEvidenceChain", () => {
  it("returns valid for a well-formed chain", async () => {
    const { pool } = makePool();
    await appendThree(pool, ORG);

    const result = await verifyEvidenceChain(pool, ORG);
    expect(result.valid).toBe(true);
    expect(result.length).toBe(3);
    expect(result.brokenAtSeq).toBeUndefined();
  });

  it("treats an empty chain as vacuously valid", async () => {
    const { pool } = makePool();
    const result = await verifyEvidenceChain(pool, ORG);
    expect(result).toEqual({ valid: true, length: 0 });
  });

  it("detects a tampered payload on a stored link", async () => {
    const { pool, rows } = makePool();
    await appendThree(pool, ORG);

    // Simulate an attacker editing the payload of link seq 2 directly in the DB,
    // WITHOUT updating its hash. Its stored hash no longer recomputes.
    const link2 = rows.find((r) => r.seq === 2)!;
    link2.payload = { verdict: "refuted", score: 0.1 };

    const result = await verifyEvidenceChain(pool, ORG);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(2);
  });

  it("detects a broken linkage (prev_hash edited)", async () => {
    const { pool, rows } = makePool();
    await appendThree(pool, ORG);

    // Break the linkage between seq 2 and seq 3 by corrupting prev_hash on 3.
    const link3 = rows.find((r) => r.seq === 3)!;
    link3.prev_hash = "deadbeef";
    // Keep its own hash "self-consistent" so only the linkage check catches it.
    link3.hash = computeLinkHash("deadbeef", {
      seq: link3.seq,
      action: link3.action,
      entityType: link3.entity_type,
      entityId: link3.entity_id,
      actor: link3.actor,
      payload: link3.payload,
    });

    const result = await verifyEvidenceChain(pool, ORG);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(3);
  });

  it("detects a deleted (gapped) link", async () => {
    const { pool, rows } = makePool();
    await appendThree(pool, ORG);

    // Remove seq 2 entirely: seq now jumps 1 -> 3.
    const idx = rows.findIndex((r) => r.seq === 2);
    rows.splice(idx, 1);

    const result = await verifyEvidenceChain(pool, ORG);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(3);
  });
});

describe("org scoping", () => {
  it("keeps each org's chain independent and seq restarts at 1 per org", async () => {
    const { pool } = makePool();
    await appendThree(pool, ORG);
    const other = await appendEvidenceAudit(pool, OTHER_ORG, {
      action: "dossier.built",
      entityType: "dossier",
      entityId: "d-1",
      payload: {},
    });

    // The other org's first link is seq 1, unaffected by ORG's three links.
    expect(other.seq).toBe(1);
    expect(other.prevHash).toBe(GENESIS_PREV_HASH);

    const mine = await listEvidenceAudit(pool, ORG, { limit: 100, offset: 0 });
    expect(mine.total).toBe(3);
    // No OTHER_ORG rows leak into ORG's listing.
    expect(mine.items.every((l) => l.orgId === ORG)).toBe(true);

    const theirs = await listEvidenceAudit(pool, OTHER_ORG, { limit: 100, offset: 0 });
    expect(theirs.total).toBe(1);
    expect(theirs.items[0].orgId).toBe(OTHER_ORG);
  });

  it("tampering in one org does not invalidate another org's chain", async () => {
    const { pool, rows } = makePool();
    await appendThree(pool, ORG);
    await appendThree(pool, OTHER_ORG);

    // Corrupt a link in OTHER_ORG only.
    const victim = rows.find((r) => r.org_id === OTHER_ORG && r.seq === 2)!;
    victim.payload = { tampered: true };

    expect((await verifyEvidenceChain(pool, ORG)).valid).toBe(true);
    const other = await verifyEvidenceChain(pool, OTHER_ORG);
    expect(other.valid).toBe(false);
    expect(other.brokenAtSeq).toBe(2);
  });
});
