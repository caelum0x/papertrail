import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  appendEvidenceAuditSchema,
  type AppendEvidenceAuditInput,
} from "@/lib/governance/evidenceAudit.schemas";

// Tamper-evident evidence audit chain — data access + hash logic.
//
// Every method is org-scoped: org_id is ALWAYS the first predicate so a caller
// can never read, append to, or verify another tenant's chain. The chain is
// per-org and independent; there is no cross-org link.
//
// Hash rule (the tamper-evidence anchor):
//   hash = sha256(prev_hash + canonical(entry))
// where canonical(entry) is a deterministic, key-sorted serialization of the
// link's identifying fields. Any retroactive edit to a stored row's action,
// entity, actor, payload, or seq changes its canonical form, so its hash — and
// every hash after it — no longer recomputes. verifyEvidenceChain detects this.
//
// The genesis link (seq 1) uses prev_hash = GENESIS_PREV_HASH ("").

export const GENESIS_PREV_HASH = "";

export interface EvidenceAuditLink {
  id: string;
  orgId: string;
  seq: number;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: string | null;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
  createdAt: string;
}

export interface VerifyResult {
  valid: boolean;
  length: number;
  // The seq of the FIRST link whose recomputed hash or prev_hash linkage does
  // not match the stored value. Absent when the chain is intact.
  brokenAtSeq?: number;
}

interface ChainRow {
  id: string;
  org_id: string;
  seq: string | number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor: string | null;
  payload: Record<string, unknown> | null;
  prev_hash: string;
  hash: string;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapRow(row: ChainRow): EvidenceAuditLink {
  return {
    id: row.id,
    orgId: row.org_id,
    seq: Number(row.seq),
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actor: row.actor,
    payload: row.payload ?? {},
    prevHash: row.prev_hash,
    hash: row.hash,
    createdAt: toIso(row.created_at),
  };
}

// The exact set of fields that are bound into the hash. seq is included so a row
// cannot be silently reordered; created_at is deliberately EXCLUDED so that
// wall-clock jitter is not part of the cryptographic identity (the ordering
// guarantee comes from seq + the prev_hash linkage, not the timestamp).
interface HashableEntry {
  seq: number;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: string | null;
  payload: Record<string, unknown>;
}

// Deterministic serialization: keys emitted in a fixed order and the payload
// JSON-stringified with recursively sorted keys, so `{a:1,b:2}` and `{b:2,a:1}`
// hash identically. This is the "canonical(entry)" referenced above.
export function canonicalEntry(entry: HashableEntry): string {
  return JSON.stringify({
    seq: entry.seq,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    actor: entry.actor,
    payload: sortValue(entry.payload),
  });
}

// Recursively sort object keys so JSON.stringify is order-independent. Arrays
// keep their order (order is meaningful in a list); primitives pass through.
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      out[key] = sortValue(src[key]);
    }
    return out;
  }
  return value;
}

// hash = sha256(prev_hash + canonical(entry)). Exported so verifyEvidenceChain
// and appendEvidenceAudit compute hashes through the exact same function.
export function computeLinkHash(prevHash: string, entry: HashableEntry): string {
  return createHash("sha256")
    .update(prevHash + canonicalEntry(entry), "utf8")
    .digest("hex");
}

// Reads the current head (highest seq) of an org's chain FOR UPDATE, so a
// concurrent append on the same org blocks until this one commits. This makes
// seq assignment race-free without a separate counter table.
async function lockHead(
  client: PoolClient,
  orgId: string
): Promise<{ seq: number; hash: string } | null> {
  const { rows } = await client.query<{ seq: string | number; hash: string }>(
    `select seq, hash
       from evidence_audit_chain
      where org_id = $1
      order by seq desc
      limit 1
      for update`,
    [orgId]
  );
  if (rows.length === 0) {
    return null;
  }
  return { seq: Number(rows[0].seq), hash: rows[0].hash };
}

// Append one link to an org's chain. Validates input, computes the next seq and
// the chained hash inside a transaction, and inserts the row. Returns the stored
// link. Throws on validation failure or DB error — appends are attestable and
// must never be silently dropped (unlike the best-effort general audit_log).
export async function appendEvidenceAudit(
  pool: Pool,
  orgId: string,
  entry: AppendEvidenceAuditInput
): Promise<EvidenceAuditLink> {
  if (!orgId) {
    throw new Error("orgId is required");
  }
  const parsed = appendEvidenceAuditSchema.parse(entry);

  const client = await pool.connect();
  try {
    await client.query("begin");
    const head = await lockHead(client, orgId);
    const seq = head ? head.seq + 1 : 1;
    const prevHash = head ? head.hash : GENESIS_PREV_HASH;

    const hashable: HashableEntry = {
      seq,
      action: parsed.action,
      entityType: parsed.entityType,
      entityId: parsed.entityId ?? null,
      actor: parsed.actor ?? null,
      payload: parsed.payload,
    };
    const hash = computeLinkHash(prevHash, hashable);

    const { rows } = await client.query<ChainRow>(
      `insert into evidence_audit_chain
         (org_id, seq, action, entity_type, entity_id, actor, payload, prev_hash, hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id, org_id, seq, action, entity_type, entity_id, actor,
                 payload, prev_hash, hash, created_at`,
      [
        orgId,
        seq,
        hashable.action,
        hashable.entityType,
        hashable.entityId,
        hashable.actor,
        JSON.stringify(hashable.payload),
        prevHash,
        hash,
      ]
    );
    await client.query("commit");
    return mapRow(rows[0]);
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// Reads a page of an org's chain, newest first. org_id is the first predicate.
export async function listEvidenceAudit(
  pool: Pool,
  orgId: string,
  params: { limit: number; offset: number }
): Promise<{ items: EvidenceAuditLink[]; total: number }> {
  if (!orgId) {
    throw new Error("orgId is required");
  }
  const countRes = await pool.query<{ total: string | number }>(
    `select count(*)::int as total from evidence_audit_chain where org_id = $1`,
    [orgId]
  );
  const total = Number(countRes.rows[0]?.total ?? 0);

  const { rows } = await pool.query<ChainRow>(
    `select id, org_id, seq, action, entity_type, entity_id, actor,
            payload, prev_hash, hash, created_at
       from evidence_audit_chain
      where org_id = $1
      order by seq desc
      limit $2 offset $3`,
    [orgId, params.limit, params.offset]
  );
  return { items: rows.map(mapRow), total };
}

// Recomputes the org's entire chain in seq order and confirms that (a) each
// link's stored prev_hash equals the previous link's stored hash and (b) each
// link's stored hash equals sha256(prev_hash + canonical(entry)). Returns the
// first seq where either check fails. An empty chain is vacuously valid.
export async function verifyEvidenceChain(
  pool: Pool,
  orgId: string
): Promise<VerifyResult> {
  if (!orgId) {
    throw new Error("orgId is required");
  }
  const { rows } = await pool.query<ChainRow>(
    `select id, org_id, seq, action, entity_type, entity_id, actor,
            payload, prev_hash, hash, created_at
       from evidence_audit_chain
      where org_id = $1
      order by seq asc`,
    [orgId]
  );

  let expectedPrev = GENESIS_PREV_HASH;
  let expectedSeq = 1;

  for (const row of rows) {
    const link = mapRow(row);

    // A gap or reorder in seq is itself tamper evidence.
    if (link.seq !== expectedSeq) {
      return { valid: false, length: rows.length, brokenAtSeq: link.seq };
    }

    // The stored linkage must match the previous link's stored hash.
    if (link.prevHash !== expectedPrev) {
      return { valid: false, length: rows.length, brokenAtSeq: link.seq };
    }

    // The stored hash must recompute from prev_hash + the canonical entry.
    const recomputed = computeLinkHash(link.prevHash, {
      seq: link.seq,
      action: link.action,
      entityType: link.entityType,
      entityId: link.entityId,
      actor: link.actor,
      payload: link.payload,
    });
    if (recomputed !== link.hash) {
      return { valid: false, length: rows.length, brokenAtSeq: link.seq };
    }

    expectedPrev = link.hash;
    expectedSeq += 1;
  }

  return { valid: true, length: rows.length };
}
