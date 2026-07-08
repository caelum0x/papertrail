import type { Pool } from "pg";
import type {
  AuditLogEntry,
  AuditFilterOptions,
  ApiKeySummary,
  UsageMetrics,
} from "@/lib/admin-audit/types";
import type { AuditFilter } from "@/lib/admin-audit/schemas";

// Data access for the admin module. Every function is org-scoped: callers pass
// the resolved ctx.org.id (never a client-supplied org id) and every query
// filters by org_id.

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
}

function toAuditEntry(row: AuditRow): AuditLogEntry {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id ?? null,
    userId: row.user_id ?? null,
    userName: row.user_name ?? null,
    userEmail: row.user_email ?? null,
    metadata: row.metadata ?? {},
    createdAt: new Date(row.created_at).toISOString(),
  };
}

// Builds the shared WHERE clause + params for audit queries. $1 is always orgId.
function auditWhere(
  orgId: string,
  filter: AuditFilter
): { clause: string; params: unknown[] } {
  const params: unknown[] = [orgId];
  const conditions: string[] = ["a.org_id = $1"];
  if (filter.action) {
    params.push(filter.action);
    conditions.push(`a.action = $${params.length}`);
  }
  if (filter.entityType) {
    params.push(filter.entityType);
    conditions.push(`a.entity_type = $${params.length}`);
  }
  if (filter.userId) {
    params.push(filter.userId);
    conditions.push(`a.user_id = $${params.length}`);
  }
  return { clause: conditions.join(" and "), params };
}

export async function countAuditEntries(
  pool: Pool,
  orgId: string,
  filter: AuditFilter
): Promise<number> {
  const { clause, params } = auditWhere(orgId, filter);
  const { rows } = await pool.query(
    `select count(*)::int as total from audit_log a where ${clause}`,
    params
  );
  return rows[0]?.total ?? 0;
}

export async function listAuditEntries(
  pool: Pool,
  orgId: string,
  filter: AuditFilter,
  limit: number,
  offset: number
): Promise<AuditLogEntry[]> {
  const { clause, params } = auditWhere(orgId, filter);
  const limitParam = `$${params.length + 1}`;
  const offsetParam = `$${params.length + 2}`;
  const { rows } = await pool.query(
    `select a.id, a.action, a.entity_type, a.entity_id, a.user_id,
            u.name as user_name, u.email as user_email,
            a.metadata, a.created_at
       from audit_log a
       left join users u on u.id = a.user_id
      where ${clause}
      order by a.created_at desc
      limit ${limitParam} offset ${offsetParam}`,
    [...params, limit, offset]
  );
  return rows.map(toAuditEntry);
}

// Distinct filter values for the audit viewer dropdowns, scoped to the org.
export async function getAuditFilterOptions(
  pool: Pool,
  orgId: string
): Promise<AuditFilterOptions> {
  const [actionsRes, entitiesRes, usersRes] = await Promise.all([
    pool.query(
      `select distinct action from audit_log where org_id = $1 order by action asc`,
      [orgId]
    ),
    pool.query(
      `select distinct entity_type from audit_log where org_id = $1 order by entity_type asc`,
      [orgId]
    ),
    pool.query(
      `select distinct u.id, u.name, u.email
         from audit_log a
         join users u on u.id = a.user_id
        where a.org_id = $1
        order by u.email asc`,
      [orgId]
    ),
  ]);
  return {
    actions: actionsRes.rows.map((r) => r.action as string),
    entityTypes: entitiesRes.rows.map((r) => r.entity_type as string),
    users: usersRes.rows.map((r) => ({
      id: r.id as string,
      name: (r.name as string | null) ?? null,
      email: r.email as string,
    })),
  };
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string | null;
  created_by_name: string | null;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
  created_at: Date | string;
}

function toApiKeySummary(row: ApiKeyRow): ApiKeySummary {
  const revokedAt = row.revoked_at
    ? new Date(row.revoked_at).toISOString()
    : null;
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix ?? null,
    createdByName: row.created_by_name ?? null,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    revokedAt,
    createdAt: new Date(row.created_at).toISOString(),
    active: revokedAt === null,
  };
}

export async function countApiKeys(pool: Pool, orgId: string): Promise<number> {
  const { rows } = await pool.query(
    `select count(*)::int as total from api_keys where org_id = $1`,
    [orgId]
  );
  return rows[0]?.total ?? 0;
}

export async function listApiKeys(
  pool: Pool,
  orgId: string,
  limit: number,
  offset: number
): Promise<ApiKeySummary[]> {
  const { rows } = await pool.query(
    `select k.id, k.name, k.key_prefix, u.name as created_by_name,
            k.last_used_at, k.revoked_at, k.created_at
       from api_keys k
       left join users u on u.id = k.created_by
      where k.org_id = $1
      order by k.created_at desc
      limit $2 offset $3`,
    [orgId, limit, offset]
  );
  return rows.map(toApiKeySummary);
}

export interface InsertApiKeyParams {
  orgId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  createdBy: string;
}

// Inserts a new key row and returns the stored summary (never the raw secret).
export async function insertApiKey(
  pool: Pool,
  params: InsertApiKeyParams
): Promise<ApiKeySummary> {
  const { rows } = await pool.query(
    `insert into api_keys (org_id, name, key_hash, key_prefix, created_by)
       values ($1, $2, $3, $4, $5)
     returning id, name, key_prefix, last_used_at, revoked_at, created_at`,
    [params.orgId, params.name, params.keyHash, params.keyPrefix, params.createdBy]
  );
  const row = rows[0];
  return toApiKeySummary({ ...row, created_by_name: null });
}

// Soft-revokes a key (sets revoked_at). Returns the updated summary, or null if
// the key does not exist in this org. Idempotent: already-revoked keys keep
// their original revoked_at.
export async function revokeApiKey(
  pool: Pool,
  orgId: string,
  keyId: string
): Promise<ApiKeySummary | null> {
  const { rows } = await pool.query(
    `update api_keys
        set revoked_at = coalesce(revoked_at, now())
      where org_id = $1 and id = $2
      returning id, name, key_prefix, last_used_at, revoked_at, created_at`,
    [orgId, keyId]
  );
  if (rows.length === 0) return null;
  return toApiKeySummary({ ...rows[0], created_by_name: null });
}

// ---------------------------------------------------------------------------
// Usage metrics
// ---------------------------------------------------------------------------

export async function getUsageMetrics(
  pool: Pool,
  orgId: string
): Promise<UsageMetrics> {
  const [
    claimsRes,
    verificationsRes,
    documentsRes,
    membersRes,
    apiKeysRes,
    auditRes,
    claimsByStatusRes,
    verificationsByOutcomeRes,
  ] = await Promise.all([
    pool.query(`select count(*)::int as c from claims where org_id = $1`, [orgId]),
    // verifications has no org_id; it links to claims via claim_id.
    pool.query(
      `select count(v.*)::int as c
         from verifications v
         join claims c on c.id = v.claim_id
        where c.org_id = $1`,
      [orgId]
    ),
    pool.query(`select count(*)::int as c from documents where org_id = $1`, [
      orgId,
    ]),
    pool.query(`select count(*)::int as c from memberships where org_id = $1`, [
      orgId,
    ]),
    pool.query(
      `select count(*)::int as c from api_keys where org_id = $1 and revoked_at is null`,
      [orgId]
    ),
    pool.query(`select count(*)::int as c from audit_log where org_id = $1`, [
      orgId,
    ]),
    pool.query(
      `select status, count(*)::int as c
         from claims where org_id = $1
        group by status order by c desc`,
      [orgId]
    ),
    pool.query(
      `select coalesce(v.discrepancy_type, 'unknown') as outcome, count(v.*)::int as c
         from verifications v
         join claims c on c.id = v.claim_id
        where c.org_id = $1
        group by v.discrepancy_type
        order by c desc`,
      [orgId]
    ),
  ]);

  return {
    claims: claimsRes.rows[0]?.c ?? 0,
    verifications: verificationsRes.rows[0]?.c ?? 0,
    documents: documentsRes.rows[0]?.c ?? 0,
    members: membersRes.rows[0]?.c ?? 0,
    apiKeys: apiKeysRes.rows[0]?.c ?? 0,
    auditEvents: auditRes.rows[0]?.c ?? 0,
    claimsByStatus: claimsByStatusRes.rows.map((r) => ({
      status: r.status as string,
      count: r.c as number,
    })),
    verificationsByOutcome: verificationsByOutcomeRes.rows.map((r) => ({
      outcome: r.outcome as string,
      count: r.c as number,
    })),
  };
}
