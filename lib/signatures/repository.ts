import type { Pool, PoolClient } from "pg";
import type {
  RequestStatus,
  SignatureCertificate,
  SignatureRequest,
  SignatureRequestDetail,
  SignatureSigner,
} from "@/lib/signatures/types";
import { computeCertHash } from "@/lib/signatures/certificate";

// Data access for the e-signature workflow. Every method is org-scoped: org_id
// is always the first predicate so a caller can never read or mutate another
// tenant's rows. Multi-step mutations (add signers, sign, cancel) run inside a
// transaction so a request and its signer trail never drift out of sync.

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

interface RequestRow {
  id: string;
  org_id: string;
  entity_type: string;
  entity_id: string;
  title: string;
  status: string;
  created_by: string | null;
  created_at: Date | string;
}

function mapRequest(row: RequestRow): SignatureRequest {
  return {
    id: row.id,
    orgId: row.org_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    status: row.status as RequestStatus,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
  };
}

interface SignerRow {
  id: string;
  org_id: string;
  request_id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  order_index: number;
  status: string;
  signed_at: Date | string | null;
  created_at: Date | string;
}

function mapSigner(row: SignerRow): SignatureSigner {
  return {
    id: row.id,
    orgId: row.org_id,
    requestId: row.request_id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    orderIndex: row.order_index,
    status: row.status as SignatureSigner["status"],
    signedAt: toIsoOrNull(row.signed_at),
    createdAt: toIso(row.created_at),
  };
}

interface CertRow {
  id: string;
  org_id: string;
  request_id: string;
  cert_hash: string;
  issued_at: Date | string;
  created_at: Date | string;
}

function mapCert(row: CertRow): SignatureCertificate {
  return {
    id: row.id,
    orgId: row.org_id,
    requestId: row.request_id,
    certHash: row.cert_hash,
    issuedAt: toIso(row.issued_at),
    createdAt: toIso(row.created_at),
  };
}

const SIGNER_SELECT = `
  select s.id, s.org_id, s.request_id, s.user_id,
         u.name as user_name, u.email as user_email,
         s.order_index, s.status, s.signed_at, s.created_at
    from signature_request_signers s
    left join users u on u.id = s.user_id
`;

// ---- Requests ------------------------------------------------------------

export async function listRequests(
  pool: Pool,
  params: {
    orgId: string;
    status?: string;
    entityType?: string;
    limit: number;
    offset: number;
  }
): Promise<{ items: SignatureRequest[]; total: number }> {
  const values: unknown[] = [params.orgId];
  let where = "org_id = $1";
  if (params.status) {
    values.push(params.status);
    where += ` and status = $${values.length}`;
  }
  if (params.entityType) {
    values.push(params.entityType);
    where += ` and entity_type = $${values.length}`;
  }

  const countRes = await pool.query(
    `select count(*)::int as total from signature_requests where ${where}`,
    values
  );
  const total = countRes.rows[0]?.total ?? 0;

  const pageValues = [...values, params.limit, params.offset];
  const { rows } = await pool.query<RequestRow>(
    `select id, org_id, entity_type, entity_id, title, status, created_by, created_at
       from signature_requests
      where ${where}
      order by created_at desc
      limit $${pageValues.length - 1} offset $${pageValues.length}`,
    pageValues
  );
  return { items: rows.map(mapRequest), total };
}

export async function getRequestById(
  pool: Pool,
  orgId: string,
  id: string
): Promise<SignatureRequest | null> {
  const { rows } = await pool.query<RequestRow>(
    `select id, org_id, entity_type, entity_id, title, status, created_by, created_at
       from signature_requests where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return rows.length ? mapRequest(rows[0]) : null;
}

async function listSignersOf(
  db: Pool | PoolClient,
  orgId: string,
  requestId: string
): Promise<SignatureSigner[]> {
  const { rows } = await db.query<SignerRow>(
    `${SIGNER_SELECT}
      where s.org_id = $1 and s.request_id = $2
      order by s.order_index asc, s.created_at asc`,
    [orgId, requestId]
  );
  return rows.map(mapSigner);
}

export async function getCertificate(
  pool: Pool,
  orgId: string,
  requestId: string
): Promise<SignatureCertificate | null> {
  const { rows } = await pool.query<CertRow>(
    `select id, org_id, request_id, cert_hash, issued_at, created_at
       from signature_certificates
      where org_id = $1 and request_id = $2`,
    [orgId, requestId]
  );
  return rows.length ? mapCert(rows[0]) : null;
}

// Full detail: request + ordered signer trail + certificate (if completed).
export async function getRequestDetail(
  pool: Pool,
  orgId: string,
  id: string
): Promise<SignatureRequestDetail | null> {
  const request = await getRequestById(pool, orgId, id);
  if (!request) return null;
  const [signers, certificate] = await Promise.all([
    listSignersOf(pool, orgId, id),
    getCertificate(pool, orgId, id),
  ]);
  return { request, signers, certificate };
}

// Create a request, optionally seeding its initial signers in order. A request
// with signers starts 'pending'; an empty one stays 'draft' until signers are
// added. Runs in a transaction so the request and its signers are atomic.
export async function createRequest(
  pool: Pool,
  params: {
    orgId: string;
    entityType: string;
    entityId: string;
    title: string;
    createdBy: string;
    signerUserIds: string[];
  }
): Promise<SignatureRequestDetail> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const status: RequestStatus =
      params.signerUserIds.length > 0 ? "pending" : "draft";

    const { rows } = await client.query<RequestRow>(
      `insert into signature_requests
         (org_id, entity_type, entity_id, title, status, created_by)
       values ($1, $2, $3, $4, $5, $6)
       returning id, org_id, entity_type, entity_id, title, status, created_by, created_at`,
      [
        params.orgId,
        params.entityType,
        params.entityId,
        params.title,
        status,
        params.createdBy,
      ]
    );
    const request = mapRequest(rows[0]);

    for (let i = 0; i < params.signerUserIds.length; i += 1) {
      await client.query(
        `insert into signature_request_signers
           (org_id, request_id, user_id, order_index, status)
         values ($1, $2, $3, $4, 'pending')`,
        [params.orgId, request.id, params.signerUserIds[i], i]
      );
    }

    await client.query("commit");
    const signers = await listSignersOf(pool, params.orgId, request.id);
    return { request, signers, certificate: null };
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export type AddSignersResult =
  | { ok: true; detail: SignatureRequestDetail }
  | { ok: false; reason: "not_found" | "not_open" | "duplicate" };

// Append signers to a draft/pending request after the current max order_index.
// Transitions a draft request to pending. Rejects duplicates (a user may sign a
// given request only once) and requests that are already completed/cancelled.
export async function addSigners(
  pool: Pool,
  params: { orgId: string; requestId: string; signerUserIds: string[] }
): Promise<AddSignersResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const reqRes = await client.query<RequestRow>(
      `select id, org_id, entity_type, entity_id, title, status, created_by, created_at
         from signature_requests
        where org_id = $1 and id = $2
        for update`,
      [params.orgId, params.requestId]
    );
    if (reqRes.rows.length === 0) {
      await client.query("rollback");
      return { ok: false, reason: "not_found" };
    }
    const status = reqRes.rows[0].status as RequestStatus;
    if (status !== "draft" && status !== "pending") {
      await client.query("rollback");
      return { ok: false, reason: "not_open" };
    }

    const existingRes = await client.query<{ user_id: string; max: number | null }>(
      `select coalesce(max(order_index), -1) as max from signature_request_signers
        where org_id = $1 and request_id = $2`,
      [params.orgId, params.requestId]
    );
    const existingIdsRes = await client.query<{ user_id: string }>(
      `select user_id from signature_request_signers
        where org_id = $1 and request_id = $2`,
      [params.orgId, params.requestId]
    );
    const existingIds = new Set(existingIdsRes.rows.map((r) => r.user_id));
    for (const id of params.signerUserIds) {
      if (existingIds.has(id)) {
        await client.query("rollback");
        return { ok: false, reason: "duplicate" };
      }
    }

    let nextIndex = Number(existingRes.rows[0]?.max ?? -1) + 1;
    for (const userId of params.signerUserIds) {
      await client.query(
        `insert into signature_request_signers
           (org_id, request_id, user_id, order_index, status)
         values ($1, $2, $3, $4, 'pending')`,
        [params.orgId, params.requestId, userId, nextIndex]
      );
      nextIndex += 1;
    }

    if (status === "draft") {
      await client.query(
        `update signature_requests set status = 'pending'
          where org_id = $1 and id = $2`,
        [params.orgId, params.requestId]
      );
    }

    await client.query("commit");
    const detail = await getRequestDetail(pool, params.orgId, params.requestId);
    return detail
      ? { ok: true, detail }
      : { ok: false, reason: "not_found" };
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export type SignResult =
  | { ok: true; detail: SignatureRequestDetail; completed: boolean }
  | {
      ok: false;
      reason: "not_found" | "not_pending" | "no_signers" | "not_your_turn";
    };

// The current signer signs. Enforces strict turn-taking: only the lowest
// order_index signer still 'pending' may sign, and only for a request in the
// 'pending' status. When the last signer signs, the request is marked completed
// and a certificate is issued in the same transaction. mfaMethod is folded into
// the audit trail by the caller; it is required by the API schema.
export async function sign(
  pool: Pool,
  params: { orgId: string; requestId: string; userId: string }
): Promise<SignResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const reqRes = await client.query<RequestRow>(
      `select id, org_id, entity_type, entity_id, title, status, created_by, created_at
         from signature_requests
        where org_id = $1 and id = $2
        for update`,
      [params.orgId, params.requestId]
    );
    if (reqRes.rows.length === 0) {
      await client.query("rollback");
      return { ok: false, reason: "not_found" };
    }
    const request = mapRequest(reqRes.rows[0]);
    if (request.status !== "pending") {
      await client.query("rollback");
      return { ok: false, reason: "not_pending" };
    }

    const pendingRes = await client.query<SignerRow>(
      `select s.id, s.org_id, s.request_id, s.user_id,
              null::text as user_name, null::text as user_email,
              s.order_index, s.status, s.signed_at, s.created_at
         from signature_request_signers s
        where s.org_id = $1 and s.request_id = $2 and s.status = 'pending'
        order by s.order_index asc, s.created_at asc
        for update`,
      [params.orgId, params.requestId]
    );
    if (pendingRes.rows.length === 0) {
      await client.query("rollback");
      return { ok: false, reason: "no_signers" };
    }
    const current = pendingRes.rows[0];
    if (current.user_id !== params.userId) {
      await client.query("rollback");
      return { ok: false, reason: "not_your_turn" };
    }

    await client.query(
      `update signature_request_signers
          set status = 'signed', signed_at = now()
        where org_id = $1 and id = $2`,
      [params.orgId, current.id]
    );

    const remaining = pendingRes.rows.length - 1;
    const completed = remaining === 0;

    if (completed) {
      await client.query(
        `update signature_requests set status = 'completed'
          where org_id = $1 and id = $2`,
        [params.orgId, params.requestId]
      );

      const signerRows = await client.query<SignerRow>(
        `${SIGNER_SELECT}
          where s.org_id = $1 and s.request_id = $2
          order by s.order_index asc, s.created_at asc`,
        [params.orgId, params.requestId]
      );
      const signers = signerRows.rows.map(mapSigner);
      const certHash = computeCertHash({
        request: {
          id: request.id,
          orgId: request.orgId,
          entityType: request.entityType,
          entityId: request.entityId,
          title: request.title,
        },
        signers: signers.map((s) => ({
          userId: s.userId,
          orderIndex: s.orderIndex,
          signedAt: s.signedAt,
        })),
      });
      await client.query(
        `insert into signature_certificates (org_id, request_id, cert_hash)
         values ($1, $2, $3)
         on conflict (org_id, request_id) do nothing`,
        [params.orgId, params.requestId, certHash]
      );
    }

    await client.query("commit");
    const detail = await getRequestDetail(pool, params.orgId, params.requestId);
    return detail
      ? { ok: true, detail, completed }
      : { ok: false, reason: "not_found" };
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export type CancelResult =
  | { ok: true; detail: SignatureRequestDetail }
  | { ok: false; reason: "not_found" | "already_final" };

// Cancel a draft/pending request. Completed and already-cancelled requests are
// terminal and cannot be cancelled.
export async function cancelRequest(
  pool: Pool,
  params: { orgId: string; requestId: string }
): Promise<CancelResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const reqRes = await client.query<RequestRow>(
      `select status from signature_requests
        where org_id = $1 and id = $2
        for update`,
      [params.orgId, params.requestId]
    );
    if (reqRes.rows.length === 0) {
      await client.query("rollback");
      return { ok: false, reason: "not_found" };
    }
    const status = reqRes.rows[0].status as RequestStatus;
    if (status === "completed" || status === "cancelled") {
      await client.query("rollback");
      return { ok: false, reason: "already_final" };
    }

    await client.query(
      `update signature_requests set status = 'cancelled'
        where org_id = $1 and id = $2`,
      [params.orgId, params.requestId]
    );
    await client.query("commit");
    const detail = await getRequestDetail(pool, params.orgId, params.requestId);
    return detail
      ? { ok: true, detail }
      : { ok: false, reason: "not_found" };
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
