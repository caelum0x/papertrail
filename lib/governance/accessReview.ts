import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import {
  accessReviewSnapshotSchema,
  type AccessReviewSnapshot,
  type CustomRoleSummary,
  type PermissionGrant,
  type RoleGrant,
} from "@/lib/complianceOps/types";

// ACCESS-REVIEW snapshot. A periodic access review (SOC 2 / ISO 27001 control:
// "review who has access, quarterly") needs a single, complete listing of every
// role and permission grant in an org. The grants already live across three
// tables (memberships, permission_grants, custom_roles); nothing ever assembled
// them for a reviewer. This module produces ONE org-scoped snapshot.
//
// Everything is org-scoped: org_id is the FIRST predicate on every query and is
// the resolved server-side org id, never a client value. All SQL is
// parameterized. The snapshot lists identities (user ids/emails) and grants —
// which is the point of an access review — but never claim/patient text or
// secrets. The result is validated against a Zod schema before it leaves this
// module so a malformed row can never masquerade as a grant.

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

interface MembershipRow {
  user_id: string;
  email: string;
  name: string | null;
  role: string;
  created_at: Date | string;
}

// Every member's coarse org role. Joined to users so the reviewer sees who each
// grant belongs to. Org-scoped, parameterized, deterministic ordering.
async function loadRoleGrants(pool: Pool, orgId: string): Promise<RoleGrant[]> {
  const { rows } = await pool.query<MembershipRow>(
    `select m.user_id, u.email, u.name, m.role, m.created_at
       from memberships m
       join users u on u.id = m.user_id
      where m.org_id = $1
      order by m.role asc, u.email asc`,
    [orgId]
  );
  return rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    name: r.name ?? null,
    role: r.role,
    grantedAt: toIso(r.created_at),
  }));
}

interface PermissionGrantRow {
  id: string;
  subject_type: string;
  subject_id: string;
  resource: string;
  action: string;
  created_at: Date | string;
}

// Every explicit fine-grained permission grant (permission_grants). Org-scoped,
// parameterized. subject_type is constrained to user/team/role by the table's
// own check; we narrow defensively when mapping.
async function loadPermissionGrants(
  pool: Pool,
  orgId: string
): Promise<PermissionGrant[]> {
  const { rows } = await pool.query<PermissionGrantRow>(
    `select id, subject_type, subject_id, resource, action, created_at
       from permission_grants
      where org_id = $1
      order by subject_type asc, resource asc, action asc`,
    [orgId]
  );
  const out: PermissionGrant[] = [];
  for (const r of rows) {
    if (r.subject_type !== "user" && r.subject_type !== "team" && r.subject_type !== "role") {
      continue; // defensive: skip any row that violates the expected domain
    }
    out.push({
      id: r.id,
      subjectType: r.subject_type,
      subjectId: r.subject_id,
      resource: r.resource,
      action: r.action,
      grantedAt: toIso(r.created_at),
    });
  }
  return out;
}

interface CustomRoleRow {
  id: string;
  name: string;
  permissions: unknown;
  created_at: Date | string;
}

// Normalizes the jsonb permissions array into a string[] of "resource:action"
// entries, dropping any non-string element so a malformed row can't poison the
// snapshot.
function normalizePermissions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

// Every named custom-role bundle (custom_roles). Org-scoped, parameterized.
async function loadCustomRoles(
  pool: Pool,
  orgId: string
): Promise<CustomRoleSummary[]> {
  const { rows } = await pool.query<CustomRoleRow>(
    `select id, name, permissions, created_at
       from custom_roles
      where org_id = $1
      order by name asc`,
    [orgId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    permissions: normalizePermissions(r.permissions),
    grantedAt: toIso(r.created_at),
  }));
}

// Assembles the org's full access-review snapshot: base role grants, explicit
// permission grants, and custom-role bundles, plus summary counts (members,
// admins, owners) a reviewer scans first. Validated against the Zod schema
// before return so the console/download always receives a well-formed artifact.
export async function buildAccessReviewSnapshot(
  orgId: string,
  pool: Pool = getPool()
): Promise<AccessReviewSnapshot> {
  const [roleGrants, permissionGrants, customRoles] = await Promise.all([
    loadRoleGrants(pool, orgId),
    loadPermissionGrants(pool, orgId),
    loadCustomRoles(pool, orgId),
  ]);

  const admins = roleGrants.filter((g) => g.role === "admin").length;
  const owners = roleGrants.filter((g) => g.role === "owner").length;

  const snapshot: AccessReviewSnapshot = {
    orgId,
    generatedAt: new Date().toISOString(),
    roleGrants,
    permissionGrants,
    customRoles,
    counts: {
      members: roleGrants.length,
      permissionGrants: permissionGrants.length,
      customRoles: customRoles.length,
      admins,
      owners,
    },
  };

  // Validate before it leaves the module — a malformed row can never masquerade
  // as a valid snapshot.
  return accessReviewSnapshotSchema.parse(snapshot);
}
