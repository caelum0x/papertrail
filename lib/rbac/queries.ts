import type { Pool } from "pg";
import type {
  CustomRole,
  Team,
  TeamMember,
} from "@/lib/rbac/types";
import { normalizePermissions } from "@/lib/rbac/catalog";

// Data-access layer for RBAC & teams. Every query is org-scoped: callers pass
// ctx.org.id so a tenant can never read or mutate another tenant's rows.

interface RoleRow {
  id: string;
  org_id: string;
  name: string;
  permissions: unknown;
  created_at: Date | string;
}

interface TeamRow {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  member_count?: string | number | null;
  created_at: Date | string;
}

interface MemberRow {
  id: string;
  org_id: string;
  team_id: string;
  user_id: string;
  user_email: string;
  user_name: string | null;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

function mapRole(row: RoleRow): CustomRole {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    permissions: normalizePermissions(toStringArray(row.permissions)),
    createdAt: toIso(row.created_at),
  };
}

function mapTeam(row: TeamRow): Team {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    description: row.description,
    memberCount: Number(row.member_count ?? 0),
    createdAt: toIso(row.created_at),
  };
}

function mapMember(row: MemberRow): TeamMember {
  return {
    id: row.id,
    orgId: row.org_id,
    teamId: row.team_id,
    userId: row.user_id,
    userEmail: row.user_email,
    userName: row.user_name,
    createdAt: toIso(row.created_at),
  };
}

/* ------------------------------- Custom roles ------------------------------ */

export async function listRoles(
  pool: Pool,
  orgId: string,
  limit: number,
  offset: number
): Promise<CustomRole[]> {
  const { rows } = await pool.query<RoleRow>(
    `select id, org_id, name, permissions, created_at
       from custom_roles
      where org_id = $1
      order by created_at desc
      limit $2 offset $3`,
    [orgId, limit, offset]
  );
  return rows.map(mapRole);
}

export async function countRoles(pool: Pool, orgId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::int as count from custom_roles where org_id = $1`,
    [orgId]
  );
  return Number(rows[0]?.count ?? 0);
}

export async function getRole(
  pool: Pool,
  orgId: string,
  id: string
): Promise<CustomRole | null> {
  const { rows } = await pool.query<RoleRow>(
    `select id, org_id, name, permissions, created_at
       from custom_roles
      where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return rows[0] ? mapRole(rows[0]) : null;
}

export async function createRole(
  pool: Pool,
  orgId: string,
  name: string,
  permissions: string[]
): Promise<CustomRole> {
  const { rows } = await pool.query<RoleRow>(
    `insert into custom_roles (org_id, name, permissions)
     values ($1, $2, $3::jsonb)
     returning id, org_id, name, permissions, created_at`,
    [orgId, name, JSON.stringify(normalizePermissions(permissions))]
  );
  return mapRole(rows[0]);
}

export async function updateRole(
  pool: Pool,
  orgId: string,
  id: string,
  fields: { name?: string; permissions?: string[] }
): Promise<CustomRole | null> {
  const sets: string[] = [];
  const params: unknown[] = [orgId, id];
  if (fields.name !== undefined) {
    params.push(fields.name);
    sets.push(`name = $${params.length}`);
  }
  if (fields.permissions !== undefined) {
    params.push(JSON.stringify(normalizePermissions(fields.permissions)));
    sets.push(`permissions = $${params.length}::jsonb`);
  }
  if (sets.length === 0) {
    return getRole(pool, orgId, id);
  }
  const { rows } = await pool.query<RoleRow>(
    `update custom_roles set ${sets.join(", ")}
      where org_id = $1 and id = $2
      returning id, org_id, name, permissions, created_at`,
    params
  );
  return rows[0] ? mapRole(rows[0]) : null;
}

export async function deleteRole(
  pool: Pool,
  orgId: string,
  id: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `delete from custom_roles where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return (rowCount ?? 0) > 0;
}

export async function roleNameExists(
  pool: Pool,
  orgId: string,
  name: string,
  excludeId?: string
): Promise<boolean> {
  const params: unknown[] = [orgId, name];
  let sql = `select 1 from custom_roles where org_id = $1 and lower(name) = lower($2)`;
  if (excludeId) {
    params.push(excludeId);
    sql += ` and id <> $3`;
  }
  const { rowCount } = await pool.query(sql, params);
  return (rowCount ?? 0) > 0;
}

/* ---------------------------------- Teams ---------------------------------- */

export async function listTeams(
  pool: Pool,
  orgId: string,
  limit: number,
  offset: number
): Promise<Team[]> {
  const { rows } = await pool.query<TeamRow>(
    `select t.id, t.org_id, t.name, t.description, t.created_at,
            count(tm.id) as member_count
       from teams t
       left join team_members tm on tm.team_id = t.id
      where t.org_id = $1
      group by t.id
      order by t.created_at desc
      limit $2 offset $3`,
    [orgId, limit, offset]
  );
  return rows.map(mapTeam);
}

export async function countTeams(pool: Pool, orgId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::int as count from teams where org_id = $1`,
    [orgId]
  );
  return Number(rows[0]?.count ?? 0);
}

export async function getTeam(
  pool: Pool,
  orgId: string,
  id: string
): Promise<Team | null> {
  const { rows } = await pool.query<TeamRow>(
    `select t.id, t.org_id, t.name, t.description, t.created_at,
            count(tm.id) as member_count
       from teams t
       left join team_members tm on tm.team_id = t.id
      where t.org_id = $1 and t.id = $2
      group by t.id`,
    [orgId, id]
  );
  return rows[0] ? mapTeam(rows[0]) : null;
}

export async function createTeam(
  pool: Pool,
  orgId: string,
  name: string,
  description: string | null
): Promise<Team> {
  const { rows } = await pool.query<TeamRow>(
    `insert into teams (org_id, name, description)
     values ($1, $2, $3)
     returning id, org_id, name, description, created_at, 0 as member_count`,
    [orgId, name, description]
  );
  return mapTeam(rows[0]);
}

export async function updateTeam(
  pool: Pool,
  orgId: string,
  id: string,
  fields: { name?: string; description?: string | null }
): Promise<Team | null> {
  const sets: string[] = [];
  const params: unknown[] = [orgId, id];
  if (fields.name !== undefined) {
    params.push(fields.name);
    sets.push(`name = $${params.length}`);
  }
  if (fields.description !== undefined) {
    params.push(fields.description);
    sets.push(`description = $${params.length}`);
  }
  if (sets.length === 0) {
    return getTeam(pool, orgId, id);
  }
  const { rowCount } = await pool.query(
    `update teams set ${sets.join(", ")} where org_id = $1 and id = $2`,
    params
  );
  if ((rowCount ?? 0) === 0) return null;
  return getTeam(pool, orgId, id);
}

export async function deleteTeam(
  pool: Pool,
  orgId: string,
  id: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `delete from teams where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return (rowCount ?? 0) > 0;
}

export async function teamNameExists(
  pool: Pool,
  orgId: string,
  name: string,
  excludeId?: string
): Promise<boolean> {
  const params: unknown[] = [orgId, name];
  let sql = `select 1 from teams where org_id = $1 and lower(name) = lower($2)`;
  if (excludeId) {
    params.push(excludeId);
    sql += ` and id <> $3`;
  }
  const { rowCount } = await pool.query(sql, params);
  return (rowCount ?? 0) > 0;
}

/* ------------------------------- Team members ------------------------------ */

export async function listTeamMembers(
  pool: Pool,
  orgId: string,
  teamId: string
): Promise<TeamMember[]> {
  const { rows } = await pool.query<MemberRow>(
    `select tm.id, tm.org_id, tm.team_id, tm.user_id, tm.created_at,
            u.email as user_email, u.name as user_name
       from team_members tm
       join users u on u.id = tm.user_id
      where tm.org_id = $1 and tm.team_id = $2
      order by tm.created_at asc`,
    [orgId, teamId]
  );
  return rows.map(mapMember);
}

// A user is only addable if they are a member of the org. Returns the row id
// on success; null if the user is not an org member.
export async function addTeamMember(
  pool: Pool,
  orgId: string,
  teamId: string,
  userId: string
): Promise<TeamMember | null> {
  const membership = await pool.query(
    `select 1 from memberships where org_id = $1 and user_id = $2`,
    [orgId, userId]
  );
  if ((membership.rowCount ?? 0) === 0) {
    return null;
  }
  await pool.query(
    `insert into team_members (org_id, team_id, user_id)
     values ($1, $2, $3)
     on conflict (team_id, user_id) do nothing`,
    [orgId, teamId, userId]
  );
  const { rows } = await pool.query<MemberRow>(
    `select tm.id, tm.org_id, tm.team_id, tm.user_id, tm.created_at,
            u.email as user_email, u.name as user_name
       from team_members tm
       join users u on u.id = tm.user_id
      where tm.org_id = $1 and tm.team_id = $2 and tm.user_id = $3`,
    [orgId, teamId, userId]
  );
  return rows[0] ? mapMember(rows[0]) : null;
}

export async function removeTeamMember(
  pool: Pool,
  orgId: string,
  teamId: string,
  userId: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `delete from team_members where org_id = $1 and team_id = $2 and user_id = $3`,
    [orgId, teamId, userId]
  );
  return (rowCount ?? 0) > 0;
}

// Org members not yet on the team — used to populate the AddMemberForm picker.
export async function listAssignableMembers(
  pool: Pool,
  orgId: string,
  teamId: string
): Promise<{ userId: string; email: string; name: string | null }[]> {
  const { rows } = await pool.query<{
    user_id: string;
    email: string;
    name: string | null;
  }>(
    `select m.user_id, u.email, u.name
       from memberships m
       join users u on u.id = m.user_id
      where m.org_id = $1
        and m.user_id not in (
          select user_id from team_members where org_id = $1 and team_id = $2
        )
      order by u.email asc`,
    [orgId, teamId]
  );
  return rows.map((r) => ({ userId: r.user_id, email: r.email, name: r.name }));
}
