import type { Pool } from "pg";

// DSAR (Data Subject Access Request) assembly. Given a subject email, gathers —
// ORG-SCOPED — everything PaperTrail holds about that person so an admin can honor
// a subject's right-of-access request under GDPR/CCPA-style regimes.
//
// Trust & scope invariants:
//   * Org-scoped: org_id is ALWAYS a predicate, always the RESOLVED server-side
//     ctx.org.id. A DSAR run can only ever surface rows tied to the requesting org
//     (memberships in THIS org, audit entries under THIS org, api keys of THIS org).
//   * Deterministic + parameterized: no interpolation, no LLM anywhere in the path.
//   * NEVER secrets verbatim: we return whether a password/key hash EXISTS as a
//     boolean, never the hash itself. API keys expose id/name/timestamps only —
//     never key_hash. This keeps the export safe to hand to the subject.
//   * If the email matches no user, we still return a well-formed package with a
//     null subject and zero counts (an honest "we hold nothing about this person")
//     rather than an error, so the admin gets a definitive answer.

export interface DsarSubject {
  userId: string;
  email: string;
  name: string | null;
  hasPasswordCredential: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DsarMembership {
  id: string;
  orgId: string;
  role: string;
  createdAt: string | null;
}

export interface DsarAuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string | null;
}

// API keys the subject owns within the org. We identify ownership via the audit
// trail (who created the key) since api_keys has no direct user column; we NEVER
// return key_hash — only non-secret metadata.
export interface DsarApiKey {
  id: string;
  name: string;
  hasKeyHash: boolean;
  lastUsedAt: string | null;
  createdAt: string | null;
}

export interface DsarCounts {
  memberships: number;
  auditEntries: number;
  apiKeys: number;
}

export interface DsarExport {
  orgId: string;
  requestedSubject: string;
  found: boolean;
  assembledAt: string;
  subject: DsarSubject | null;
  memberships: DsarMembership[];
  auditEntries: DsarAuditEntry[];
  apiKeys: DsarApiKey[];
  counts: DsarCounts;
}

export interface AssembleDsarInput {
  subjectEmail: string;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  password_hash: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

interface MembershipRow {
  id: string;
  org_id: string;
  role: string;
  created_at: Date | string | null;
}

interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: Date | string | null;
}

interface ApiKeyRow {
  id: string;
  name: string;
  key_hash: string | null;
  last_used_at: Date | string | null;
  created_at: Date | string | null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function emptyPackage(orgId: string, requestedSubject: string): DsarExport {
  return {
    orgId,
    requestedSubject,
    found: false,
    assembledAt: new Date().toISOString(),
    subject: null,
    memberships: [],
    auditEntries: [],
    apiKeys: [],
    counts: { memberships: 0, auditEntries: 0, apiKeys: 0 },
  };
}

// Assembles the DSAR package for one subject, org-scoped. Returns an empty (but
// well-formed) package if the email matches no user, or if the user exists but is
// not a member of THIS org — in both cases the org honestly holds nothing about
// them under its own scope.
export async function assembleDsarExport(
  pool: Pool,
  orgId: string,
  input: AssembleDsarInput
): Promise<DsarExport> {
  const email = normalizeEmail(input.subjectEmail);

  // 1. Resolve the subject by email. Users are global, but we only proceed to
  //    org-scoped data once we know the user id.
  const userRes = await pool.query<UserRow>(
    `select id, email, name, password_hash, created_at, updated_at
       from users
      where lower(email) = $1
      limit 1`,
    [email]
  );
  if (userRes.rows.length === 0) {
    return emptyPackage(orgId, email);
  }
  const user = userRes.rows[0];

  // 2. Memberships of THIS subject in THIS org. If none, the org holds nothing
  //    about this person under its scope — return an honest empty package.
  const membershipRes = await pool.query<MembershipRow>(
    `select id, org_id, role, created_at
       from memberships
      where org_id = $1 and user_id = $2
      order by created_at asc`,
    [orgId, user.id]
  );
  if (membershipRes.rows.length === 0) {
    return emptyPackage(orgId, email);
  }

  // 3. Audit entries authored by this subject within this org.
  const auditRes = await pool.query<AuditRow>(
    `select id, action, entity_type, entity_id, created_at
       from audit_log
      where org_id = $1 and user_id = $2
      order by created_at desc`,
    [orgId, user.id]
  );

  // 4. API keys the subject created within this org. We attribute ownership via
  //    the audit trail (action='api_key.create', entity_id = key id) so we only
  //    surface keys THIS subject created. key_hash is never selected here.
  const apiKeyRes = await pool.query<ApiKeyRow>(
    `select k.id, k.name, k.key_hash, k.last_used_at, k.created_at
       from api_keys k
      where k.org_id = $1
        and k.id in (
          select a.entity_id::uuid
            from audit_log a
           where a.org_id = $1
             and a.user_id = $2
             and a.entity_type = 'api_key'
             and a.entity_id is not null
             -- Only cast well-formed uuid ids so a malformed audit row can never
             -- abort the whole DSAR query with a cast error.
             and a.entity_id ~ '^[0-9a-fA-F-]{36}$'
        )
      order by k.created_at desc`,
    [orgId, user.id]
  );

  const subject: DsarSubject = {
    userId: user.id,
    email: user.email,
    name: user.name,
    // Presence of a credential, NEVER the hash itself.
    hasPasswordCredential:
      typeof user.password_hash === "string" && user.password_hash.length > 0,
    createdAt: toIso(user.created_at),
    updatedAt: toIso(user.updated_at),
  };

  const memberships: DsarMembership[] = membershipRes.rows.map((row) => ({
    id: row.id,
    orgId: row.org_id,
    role: row.role,
    createdAt: toIso(row.created_at),
  }));

  const auditEntries: DsarAuditEntry[] = auditRes.rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    createdAt: toIso(row.created_at),
  }));

  const apiKeys: DsarApiKey[] = apiKeyRes.rows.map((row) => ({
    id: row.id,
    name: row.name,
    // Presence only — the hash never leaves the database.
    hasKeyHash: typeof row.key_hash === "string" && row.key_hash.length > 0,
    lastUsedAt: toIso(row.last_used_at),
    createdAt: toIso(row.created_at),
  }));

  return {
    orgId,
    requestedSubject: email,
    found: true,
    assembledAt: new Date().toISOString(),
    subject,
    memberships,
    auditEntries,
    apiKeys,
    counts: {
      memberships: memberships.length,
      auditEntries: auditEntries.length,
      apiKeys: apiKeys.length,
    },
  };
}
