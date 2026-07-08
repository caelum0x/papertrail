import { createHash, randomBytes } from "crypto";
import type { Pool } from "pg";
import { redactSsoConfig } from "@/lib/sso/config";
import type {
  SsoConnection,
  SsoProtocol,
  SsoStatus,
  ScimDirectory,
  ScimStatus,
  MfaFactor,
  MfaFactorType,
} from "@/lib/sso/types";

// Data access for sso_connections, scim_directories and mfa_factors. Every query
// is org-scoped: the caller passes ctx.org.id and it is always in the WHERE
// clause so one org can never read or mutate another's identity config.
// Parameterized throughout. Secrets (SSO config secret fields, SCIM tokens, MFA
// secrets) never leave via the mapping functions used for API responses.

function toObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// SHA-256 hash for SCIM bearer tokens (deterministic O(1) lookup, not reversible).
export function hashBearerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Generate a high-entropy SCIM bearer token shown to the admin exactly once.
export function generateBearerToken(): string {
  return `scim_${randomBytes(24).toString("base64url")}`;
}

// --- SSO connections -------------------------------------------------------

interface SsoRow {
  id: string;
  protocol: string;
  name: string;
  config: unknown;
  domain: string | null;
  verified: boolean;
  status: string;
  created_at: Date | string;
}

// Maps a row to the API shape with secret config fields masked.
function toConnection(row: SsoRow): SsoConnection {
  const protocol = row.protocol as SsoProtocol;
  return {
    id: row.id,
    protocol,
    name: row.name,
    config: redactSsoConfig(protocol, toObject(row.config)),
    domain: row.domain,
    verified: row.verified,
    status: row.status as SsoStatus,
    createdAt: toIso(row.created_at) as string,
  };
}

export async function countConnections(pool: Pool, orgId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `select count(*)::int as n from sso_connections where org_id = $1`,
    [orgId]
  );
  return rows[0]?.n ?? 0;
}

export async function listConnections(
  pool: Pool,
  orgId: string,
  limit: number,
  offset: number
): Promise<SsoConnection[]> {
  const { rows } = await pool.query<SsoRow>(
    `select id, protocol, name, config, domain, verified, status, created_at
       from sso_connections
      where org_id = $1
      order by created_at desc
      limit $2 offset $3`,
    [orgId, limit, offset]
  );
  return rows.map(toConnection);
}

export async function getConnection(
  pool: Pool,
  orgId: string,
  id: string
): Promise<SsoConnection | null> {
  const { rows } = await pool.query<SsoRow>(
    `select id, protocol, name, config, domain, verified, status, created_at
       from sso_connections
      where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return rows[0] ? toConnection(rows[0]) : null;
}

// Returns a connection WITH its unredacted config + protocol, for internal use
// by the update (config merge) path only. Never return this shape in an API body.
export async function getConnectionRaw(
  pool: Pool,
  orgId: string,
  id: string
): Promise<{
  id: string;
  protocol: SsoProtocol;
  domain: string | null;
  verified: boolean;
  config: Record<string, unknown>;
} | null> {
  const { rows } = await pool.query<SsoRow>(
    `select id, protocol, domain, verified, config
       from sso_connections
      where org_id = $1 and id = $2`,
    [orgId, id]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    protocol: row.protocol as SsoProtocol,
    domain: row.domain,
    verified: row.verified,
    config: toObject(row.config),
  };
}

export interface InsertConnectionInput {
  orgId: string;
  protocol: SsoProtocol;
  name: string;
  domain: string | null;
  config: Record<string, unknown>;
}

export async function insertConnection(
  pool: Pool,
  input: InsertConnectionInput
): Promise<SsoConnection> {
  const { rows } = await pool.query<SsoRow>(
    `insert into sso_connections (org_id, protocol, name, domain, config, verified, status)
     values ($1, $2, $3, $4, $5::jsonb, false, 'draft')
     returning id, protocol, name, config, domain, verified, status, created_at`,
    [
      input.orgId,
      input.protocol,
      input.name,
      input.domain,
      JSON.stringify(input.config),
    ]
  );
  return toConnection(rows[0]);
}

export interface UpdateConnectionFields {
  name?: string;
  status?: SsoStatus;
  domain?: string;
  config?: Record<string, unknown>;
  verified?: boolean;
}

// Immutable-style partial update: only provided fields change. Returns the
// updated connection, or null if it doesn't exist in this org.
export async function updateConnection(
  pool: Pool,
  orgId: string,
  id: string,
  fields: UpdateConnectionFields
): Promise<SsoConnection | null> {
  const sets: string[] = [];
  const params: unknown[] = [orgId, id];
  let i = 3;

  if (fields.name !== undefined) {
    sets.push(`name = $${i++}`);
    params.push(fields.name);
  }
  if (fields.status !== undefined) {
    sets.push(`status = $${i++}`);
    params.push(fields.status);
  }
  if (fields.domain !== undefined) {
    sets.push(`domain = $${i++}`);
    params.push(fields.domain);
  }
  if (fields.config !== undefined) {
    sets.push(`config = $${i++}::jsonb`);
    params.push(JSON.stringify(fields.config));
  }
  if (fields.verified !== undefined) {
    sets.push(`verified = $${i++}`);
    params.push(fields.verified);
  }

  if (sets.length === 0) {
    return getConnection(pool, orgId, id);
  }

  const { rows } = await pool.query<SsoRow>(
    `update sso_connections set ${sets.join(", ")}
      where org_id = $1 and id = $2
      returning id, protocol, name, config, domain, verified, status, created_at`,
    params
  );
  return rows[0] ? toConnection(rows[0]) : null;
}

export async function deleteConnection(
  pool: Pool,
  orgId: string,
  id: string
): Promise<SsoConnection | null> {
  const { rows } = await pool.query<SsoRow>(
    `delete from sso_connections
      where org_id = $1 and id = $2
      returning id, protocol, name, config, domain, verified, status, created_at`,
    [orgId, id]
  );
  return rows[0] ? toConnection(rows[0]) : null;
}

// --- SCIM directories ------------------------------------------------------

interface ScimRow {
  id: string;
  name: string;
  last_sync_at: Date | string | null;
  status: string;
  created_at: Date | string;
}

function toDirectory(row: ScimRow): ScimDirectory {
  return {
    id: row.id,
    name: row.name,
    lastSyncAt: toIso(row.last_sync_at),
    status: row.status as ScimStatus,
    createdAt: toIso(row.created_at) as string,
  };
}

export async function countDirectories(pool: Pool, orgId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `select count(*)::int as n from scim_directories where org_id = $1`,
    [orgId]
  );
  return rows[0]?.n ?? 0;
}

export async function listDirectories(
  pool: Pool,
  orgId: string,
  limit: number,
  offset: number
): Promise<ScimDirectory[]> {
  const { rows } = await pool.query<ScimRow>(
    `select id, name, last_sync_at, status, created_at
       from scim_directories
      where org_id = $1
      order by created_at desc
      limit $2 offset $3`,
    [orgId, limit, offset]
  );
  return rows.map(toDirectory);
}

export async function getDirectory(
  pool: Pool,
  orgId: string,
  id: string
): Promise<ScimDirectory | null> {
  const { rows } = await pool.query<ScimRow>(
    `select id, name, last_sync_at, status, created_at
       from scim_directories
      where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return rows[0] ? toDirectory(rows[0]) : null;
}

export async function insertDirectory(
  pool: Pool,
  input: { orgId: string; name: string; bearerTokenHash: string }
): Promise<ScimDirectory> {
  const { rows } = await pool.query<ScimRow>(
    `insert into scim_directories (org_id, name, bearer_token_hash, status)
     values ($1, $2, $3, 'active')
     returning id, name, last_sync_at, status, created_at`,
    [input.orgId, input.name, input.bearerTokenHash]
  );
  return toDirectory(rows[0]);
}

export async function deleteDirectory(
  pool: Pool,
  orgId: string,
  id: string
): Promise<ScimDirectory | null> {
  const { rows } = await pool.query<ScimRow>(
    `delete from scim_directories
      where org_id = $1 and id = $2
      returning id, name, last_sync_at, status, created_at`,
    [orgId, id]
  );
  return rows[0] ? toDirectory(rows[0]) : null;
}

// --- MFA factors -----------------------------------------------------------

interface MfaRow {
  id: string;
  type: string;
  secret: string;
  verified: boolean;
  created_at: Date | string;
}

function toFactor(row: MfaRow): MfaFactor {
  return {
    id: row.id,
    type: row.type as MfaFactorType,
    verified: row.verified,
    createdAt: toIso(row.created_at) as string,
  };
}

// A user's factors within an org (secret never included).
export async function listFactors(
  pool: Pool,
  orgId: string,
  userId: string
): Promise<MfaFactor[]> {
  const { rows } = await pool.query<MfaRow>(
    `select id, type, secret, verified, created_at
       from mfa_factors
      where org_id = $1 and user_id = $2
      order by created_at desc`,
    [orgId, userId]
  );
  return rows.map(toFactor);
}

export async function insertFactor(
  pool: Pool,
  input: { orgId: string; userId: string; type: MfaFactorType; secret: string }
): Promise<MfaFactor> {
  const { rows } = await pool.query<MfaRow>(
    `insert into mfa_factors (org_id, user_id, type, secret, verified)
     values ($1, $2, $3, $4, false)
     returning id, type, secret, verified, created_at`,
    [input.orgId, input.userId, input.type, input.secret]
  );
  return toFactor(rows[0]);
}

// Returns a factor WITH its secret, for the verify path only (server-side).
export async function getFactorSecret(
  pool: Pool,
  orgId: string,
  userId: string,
  id: string
): Promise<{ id: string; type: MfaFactorType; secret: string; verified: boolean } | null> {
  const { rows } = await pool.query<MfaRow>(
    `select id, type, secret, verified, created_at
       from mfa_factors
      where org_id = $1 and user_id = $2 and id = $3`,
    [orgId, userId, id]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    type: row.type as MfaFactorType,
    secret: row.secret,
    verified: row.verified,
  };
}

export async function markFactorVerified(
  pool: Pool,
  orgId: string,
  userId: string,
  id: string
): Promise<MfaFactor | null> {
  const { rows } = await pool.query<MfaRow>(
    `update mfa_factors set verified = true
      where org_id = $1 and user_id = $2 and id = $3
      returning id, type, secret, verified, created_at`,
    [orgId, userId, id]
  );
  return rows[0] ? toFactor(rows[0]) : null;
}

export async function deleteFactor(
  pool: Pool,
  orgId: string,
  userId: string,
  id: string
): Promise<MfaFactor | null> {
  const { rows } = await pool.query<MfaRow>(
    `delete from mfa_factors
      where org_id = $1 and user_id = $2 and id = $3
      returning id, type, secret, verified, created_at`,
    [orgId, userId, id]
  );
  return rows[0] ? toFactor(rows[0]) : null;
}
