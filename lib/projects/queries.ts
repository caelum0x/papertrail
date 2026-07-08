import type { Pool } from "pg";
import type {
  Project,
  ProjectMember,
  ProjectStatus,
} from "@/lib/projects/types";

// Data-access layer for the Projects module. Every query is org-scoped: callers
// pass ctx.org.id so a tenant can never read or mutate another tenant's rows.

interface ProjectRow {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function countProjects(pool: Pool, orgId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::int as count from projects where org_id = $1`,
    [orgId]
  );
  return Number(rows[0]?.count ?? 0);
}

export async function listProjects(
  pool: Pool,
  orgId: string,
  limit: number,
  offset: number
): Promise<Project[]> {
  const { rows } = await pool.query<ProjectRow>(
    `select id, org_id, name, description, status, created_by, created_at, updated_at
       from projects
      where org_id = $1
      order by created_at desc
      limit $2 offset $3`,
    [orgId, limit, offset]
  );
  return rows.map(mapProject);
}

export async function getProject(
  pool: Pool,
  orgId: string,
  projectId: string
): Promise<Project | null> {
  const { rows } = await pool.query<ProjectRow>(
    `select id, org_id, name, description, status, created_by, created_at, updated_at
       from projects
      where org_id = $1 and id = $2`,
    [orgId, projectId]
  );
  return rows[0] ? mapProject(rows[0]) : null;
}

export async function createProject(
  pool: Pool,
  input: {
    orgId: string;
    name: string;
    description: string | null;
    createdBy: string;
  }
): Promise<Project> {
  const { rows } = await pool.query<ProjectRow>(
    `insert into projects (org_id, name, description, created_by)
     values ($1, $2, $3, $4)
     returning id, org_id, name, description, status, created_by, created_at, updated_at`,
    [input.orgId, input.name, input.description, input.createdBy]
  );
  return mapProject(rows[0]);
}

export async function updateProject(
  pool: Pool,
  orgId: string,
  projectId: string,
  patch: { name?: string; description?: string | null; status?: ProjectStatus }
): Promise<Project | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (patch.name !== undefined) {
    sets.push(`name = $${i++}`);
    values.push(patch.name);
  }
  if (patch.description !== undefined) {
    sets.push(`description = $${i++}`);
    values.push(patch.description);
  }
  if (patch.status !== undefined) {
    sets.push(`status = $${i++}`);
    values.push(patch.status);
  }
  sets.push(`updated_at = now()`);

  values.push(orgId, projectId);
  const { rows } = await pool.query<ProjectRow>(
    `update projects set ${sets.join(", ")}
      where org_id = $${i++} and id = $${i}
      returning id, org_id, name, description, status, created_by, created_at, updated_at`,
    values
  );
  return rows[0] ? mapProject(rows[0]) : null;
}

export async function deleteProject(
  pool: Pool,
  orgId: string,
  projectId: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `delete from projects where org_id = $1 and id = $2`,
    [orgId, projectId]
  );
  return (rowCount ?? 0) > 0;
}

interface MemberRow {
  id: string;
  project_id: string;
  user_id: string;
  role: ProjectMember["role"];
  name: string | null;
  email: string;
  created_at: Date | string;
}

function mapMember(row: MemberRow): ProjectMember {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    role: row.role,
    name: row.name,
    email: row.email,
    createdAt: toIso(row.created_at),
  };
}

export async function listMembers(
  pool: Pool,
  orgId: string,
  projectId: string
): Promise<ProjectMember[]> {
  const { rows } = await pool.query<MemberRow>(
    `select pm.id, pm.project_id, pm.user_id, pm.role,
            u.name, u.email, pm.created_at
       from project_members pm
       join users u on u.id = pm.user_id
      where pm.org_id = $1 and pm.project_id = $2
      order by pm.created_at asc`,
    [orgId, projectId]
  );
  return rows.map(mapMember);
}

// Confirms the target user belongs to the org before we add them to a project.
export async function isOrgMember(
  pool: Pool,
  orgId: string,
  userId: string
): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `select exists(
       select 1 from memberships where org_id = $1 and user_id = $2
     ) as exists`,
    [orgId, userId]
  );
  return Boolean(rows[0]?.exists);
}

export async function addMember(
  pool: Pool,
  input: {
    orgId: string;
    projectId: string;
    userId: string;
    role: ProjectMember["role"];
  }
): Promise<ProjectMember | null> {
  await pool.query(
    `insert into project_members (org_id, project_id, user_id, role)
     values ($1, $2, $3, $4)
     on conflict (project_id, user_id)
     do update set role = excluded.role, updated_at = now()`,
    [input.orgId, input.projectId, input.userId, input.role]
  );
  const { rows } = await pool.query<MemberRow>(
    `select pm.id, pm.project_id, pm.user_id, pm.role,
            u.name, u.email, pm.created_at
       from project_members pm
       join users u on u.id = pm.user_id
      where pm.org_id = $1 and pm.project_id = $2 and pm.user_id = $3`,
    [input.orgId, input.projectId, input.userId]
  );
  return rows[0] ? mapMember(rows[0]) : null;
}
