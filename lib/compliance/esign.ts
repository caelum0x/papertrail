import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import type { Ctx } from "@/lib/api/handler";
import { canonicalize, sha256Hex } from "@/lib/compliance/hash";
import { appendToChain } from "@/lib/compliance/chain";
import type { Signature, SignatureMeaning } from "@/lib/compliance/types";

// Electronic signatures (21 CFR Part 11-style). A signature binds a signer +
// a declared `meaning` to a specific entity at a specific time, and records the
// hash of what was signed. The signing act is itself appended to the WORM audit
// chain, so the signature is anchored to the tamper-evident ledger.

interface SignatureRow {
  id: string;
  org_id: string;
  entity_type: string;
  entity_id: string;
  signer_id: string;
  signer_name: string | null;
  signer_email: string | null;
  meaning: string;
  signed_hash: string;
  signed_at: string | Date;
  created_at: string | Date;
}

function mapRow(row: SignatureRow): Signature {
  return {
    id: row.id,
    org_id: row.org_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    signer_id: row.signer_id,
    signer_name: row.signer_name ?? null,
    signer_email: row.signer_email ?? null,
    meaning: row.meaning as SignatureMeaning,
    signed_hash: row.signed_hash,
    signed_at:
      row.signed_at instanceof Date
        ? row.signed_at.toISOString()
        : String(row.signed_at),
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

// Compute the hash a signer is attesting to: a canonical binding of who signed
// what, with which meaning. Deterministic so it can be re-derived and audited.
function computeSignedHash(params: {
  orgId: string;
  entityType: string;
  entityId: string;
  signerId: string;
  meaning: SignatureMeaning;
  signedAt: string;
}): string {
  return sha256Hex(
    canonicalize({
      org_id: params.orgId,
      entity_type: params.entityType,
      entity_id: params.entityId,
      signer_id: params.signerId,
      meaning: params.meaning,
      signed_at: params.signedAt,
    })
  );
}

export interface SignEntityInput {
  entityType: string;
  entityId: string;
  meaning: SignatureMeaning;
}

// Record an e-signature for the acting user (ctx) over an entity, and append the
// event to the org's audit chain. Returns the persisted signature.
export async function signEntity(
  ctx: Ctx,
  input: SignEntityInput,
  pool: Pool = getPool()
): Promise<Signature> {
  const signedAt = new Date().toISOString();
  const signedHash = computeSignedHash({
    orgId: ctx.org.id,
    entityType: input.entityType,
    entityId: input.entityId,
    signerId: ctx.user.id,
    meaning: input.meaning,
    signedAt,
  });

  const { rows } = await pool.query<SignatureRow>(
    `insert into signatures
       (org_id, entity_type, entity_id, signer_id, meaning, signed_hash, signed_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, org_id, entity_type, entity_id, signer_id, meaning,
               signed_hash, signed_at, created_at`,
    [
      ctx.org.id,
      input.entityType,
      input.entityId,
      ctx.user.id,
      input.meaning,
      signedHash,
      signedAt,
    ]
  );

  const row = rows[0];

  // Anchor the signature to the tamper-evident chain. If the chain append fails,
  // the whole request fails — a signature that isn't in the ledger is not trusted.
  await appendToChain(
    ctx.org.id,
    {
      kind: "signature",
      signature_id: row.id,
      entity_type: input.entityType,
      entity_id: input.entityId,
      signer_id: ctx.user.id,
      signer_email: ctx.user.email,
      meaning: input.meaning,
      signed_hash: signedHash,
      signed_at: signedAt,
    },
    pool
  );

  return mapRow({
    ...row,
    signer_name: ctx.user.name ?? null,
    signer_email: ctx.user.email,
  });
}

export interface ListSignaturesOptions {
  orgId: string;
  limit: number;
  offset: number;
  entityType?: string;
  entityId?: string;
}

// List org signatures, optionally filtered to a specific entity, newest first.
export async function listSignatures(
  opts: ListSignaturesOptions,
  pool: Pool = getPool()
): Promise<{ items: Signature[]; total: number }> {
  const params: unknown[] = [opts.orgId];
  let where = "s.org_id = $1";
  if (opts.entityType) {
    params.push(opts.entityType);
    where += ` and s.entity_type = $${params.length}`;
  }
  if (opts.entityId) {
    params.push(opts.entityId);
    where += ` and s.entity_id = $${params.length}`;
  }

  const countResult = await pool.query<{ count: string }>(
    `select count(*)::text as count from signatures s where ${where}`,
    params
  );

  params.push(opts.limit);
  const limitIdx = params.length;
  params.push(opts.offset);
  const offsetIdx = params.length;

  const rows = await pool.query<SignatureRow>(
    `select s.id, s.org_id, s.entity_type, s.entity_id, s.signer_id,
            u.name as signer_name, u.email as signer_email,
            s.meaning, s.signed_hash, s.signed_at, s.created_at
       from signatures s
       left join users u on u.id = s.signer_id
      where ${where}
      order by s.signed_at desc
      limit $${limitIdx} offset $${offsetIdx}`,
    params
  );

  return {
    items: rows.rows.map(mapRow),
    total: Number(countResult.rows[0]?.count ?? 0),
  };
}
