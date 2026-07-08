import type { Pool, PoolClient } from "pg";
import { getPool } from "@/lib/db";
import {
  GENESIS_PREV_HASH,
  computeEntryHash,
} from "@/lib/compliance/hash";
import type { AuditChainEntry, ChainVerification } from "@/lib/compliance/types";

// WORM (write-once, read-many) hash-chained audit ledger.
//
// Every org has its own chain. appendToChain() adds an entry whose entry_hash is
// derived from the previous entry's hash plus the canonical event, so the chain
// is tamper-evident: altering any historical event invalidates every hash after
// it. verifyChain() recomputes the whole chain to detect exactly that.

interface AuditChainRow {
  id: string;
  org_id: string;
  seq: string | number;
  prev_hash: string;
  entry_hash: string;
  event: Record<string, unknown> | null;
  created_at: string | Date;
}

function mapRow(row: AuditChainRow): AuditChainEntry {
  return {
    id: row.id,
    org_id: row.org_id,
    seq: Number(row.seq),
    prev_hash: row.prev_hash,
    entry_hash: row.entry_hash,
    event: row.event ?? {},
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

// Derive a stable 64-bit advisory-lock key from an org id so concurrent appends
// for the same org serialize (and thus never race on seq / prev_hash), while
// different orgs proceed independently.
function orgLockKey(orgId: string): bigint {
  let hash = 1469598103934665603n; // FNV-1a 64-bit offset basis
  const prime = 1099511628211n;
  const mask = (1n << 64n) - 1n;
  for (let i = 0; i < orgId.length; i += 1) {
    hash ^= BigInt(orgId.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  // Map to signed 64-bit range expected by pg_advisory_xact_lock(bigint).
  return hash >= 1n << 63n ? hash - (1n << 64n) : hash;
}

// Append an event to the org's chain and return the created entry. Runs inside a
// transaction with a per-org advisory lock so seq allocation and prev_hash
// lookup are atomic under concurrency.
export async function appendToChain(
  orgId: string,
  event: Record<string, unknown>,
  pool: Pool = getPool()
): Promise<AuditChainEntry> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock($1)", [
      orgLockKey(orgId).toString(),
    ]);

    const tail = await client.query<AuditChainRow>(
      `select entry_hash, seq
         from audit_chain
        where org_id = $1
        order by seq desc
        limit 1`,
      [orgId]
    );

    const prevHash =
      tail.rows.length > 0 ? tail.rows[0].entry_hash : GENESIS_PREV_HASH;
    const nextSeq =
      tail.rows.length > 0 ? Number(tail.rows[0].seq) + 1 : 1;
    const entryHash = computeEntryHash(prevHash, event);

    const inserted = await client.query<AuditChainRow>(
      `insert into audit_chain (org_id, seq, prev_hash, entry_hash, event)
       values ($1, $2, $3, $4, $5::jsonb)
       returning id, org_id, seq, prev_hash, entry_hash, event, created_at`,
      [orgId, nextSeq, prevHash, entryHash, JSON.stringify(event)]
    );

    await client.query("commit");
    return mapRow(inserted.rows[0]);
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export interface ListChainOptions {
  orgId: string;
  limit: number;
  offset: number;
}

export async function listChainEntries(
  opts: ListChainOptions,
  pool: Pool = getPool()
): Promise<{ items: AuditChainEntry[]; total: number }> {
  const { orgId, limit, offset } = opts;
  const [rows, count] = await Promise.all([
    pool.query<AuditChainRow>(
      `select id, org_id, seq, prev_hash, entry_hash, event, created_at
         from audit_chain
        where org_id = $1
        order by seq desc
        limit $2 offset $3`,
      [orgId, limit, offset]
    ),
    pool.query<{ count: string }>(
      `select count(*)::text as count from audit_chain where org_id = $1`,
      [orgId]
    ),
  ]);
  return {
    items: rows.rows.map(mapRow),
    total: Number(count.rows[0]?.count ?? 0),
  };
}

// Recompute the entire chain in sequence order and verify: (1) each entry links
// to the prior entry's hash, (2) seq is contiguous from 1, (3) each stored
// entry_hash equals the recomputed hash. Returns the first break, if any.
export async function verifyChain(
  orgId: string,
  pool: Pool = getPool()
): Promise<ChainVerification> {
  const { rows } = await pool.query<AuditChainRow>(
    `select id, org_id, seq, prev_hash, entry_hash, event, created_at
       from audit_chain
      where org_id = $1
      order by seq asc`,
    [orgId]
  );

  let expectedPrev = GENESIS_PREV_HASH;
  let expectedSeq = 1;

  for (const raw of rows) {
    const entry = mapRow(raw);

    if (entry.seq !== expectedSeq) {
      return {
        ok: false,
        length: rows.length,
        brokenAtSeq: entry.seq,
        reason: `Non-contiguous sequence: expected ${expectedSeq}, found ${entry.seq}.`,
      };
    }
    if (entry.prev_hash !== expectedPrev) {
      return {
        ok: false,
        length: rows.length,
        brokenAtSeq: entry.seq,
        reason: `Broken linkage at seq ${entry.seq}: prev_hash does not match prior entry.`,
      };
    }
    const recomputed = computeEntryHash(entry.prev_hash, entry.event);
    if (recomputed !== entry.entry_hash) {
      return {
        ok: false,
        length: rows.length,
        brokenAtSeq: entry.seq,
        reason: `Tampered event at seq ${entry.seq}: recomputed hash does not match stored hash.`,
      };
    }

    expectedPrev = entry.entry_hash;
    expectedSeq += 1;
  }

  return {
    ok: true,
    length: rows.length,
    brokenAtSeq: null,
    reason: null,
  };
}
