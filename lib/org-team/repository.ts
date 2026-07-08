import { randomBytes } from "crypto";
import type { Pool } from "pg";
import type { Role } from "@/lib/authz/rbac";
import type { Member, Invitation, OrgSettings } from "@/lib/org-team/types";

// Data access for the org & team module. Every function is org-scoped: callers
// must pass the resolved ctx.org.id and never a client-supplied org id.

export function generateInviteToken(): string {
  return randomBytes(24).toString("hex");
}

interface MemberRow {
  id: string;
  user_id: string;
  email: string;
  name: string | null;
  role: Role;
  created_at: Date | string;
}

function toMember(row: MemberRow): Member {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    name: row.name ?? null,
    role: row.role,
    joinedAt: new Date(row.created_at).toISOString(),
  };
}

export async function countMembers(pool: Pool, orgId: string): Promise<number> {
  const { rows } = await pool.query(
    `select count(*)::int as total from memberships where org_id = $1`,
    [orgId]
  );
  return rows[0]?.total ?? 0;
}

export async function listMembers(
  pool: Pool,
  orgId: string,
  limit: number,
  offset: number
): Promise<Member[]> {
  const { rows } = await pool.query(
    `select m.id, m.user_id, u.email, u.name, m.role, m.created_at
       from memberships m
       join users u on u.id = m.user_id
      where m.org_id = $1
      order by m.created_at asc
      limit $2 offset $3`,
    [orgId, limit, offset]
  );
  return rows.map(toMember);
}

export async function getMember(
  pool: Pool,
  orgId: string,
  membershipId: string
): Promise<Member | null> {
  const { rows } = await pool.query(
    `select m.id, m.user_id, u.email, u.name, m.role, m.created_at
       from memberships m
       join users u on u.id = m.user_id
      where m.org_id = $1 and m.id = $2`,
    [orgId, membershipId]
  );
  return rows.length ? toMember(rows[0]) : null;
}

// How many owners remain in the org — used to block removing/demoting the last one.
export async function countOwners(pool: Pool, orgId: string): Promise<number> {
  const { rows } = await pool.query(
    `select count(*)::int as total
       from memberships where org_id = $1 and role = 'owner'`,
    [orgId]
  );
  return rows[0]?.total ?? 0;
}

interface InvitationRow {
  id: string;
  email: string;
  role: Role;
  token: string;
  invited_by: string | null;
  inviter_name: string | null;
  accepted_at: Date | string | null;
  created_at: Date | string;
}

function toInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    token: row.token,
    invitedBy: row.invited_by ?? null,
    inviterName: row.inviter_name ?? null,
    acceptedAt: row.accepted_at ? new Date(row.accepted_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    pending: row.accepted_at === null || row.accepted_at === undefined,
  };
}

export async function countInvitations(
  pool: Pool,
  orgId: string
): Promise<number> {
  const { rows } = await pool.query(
    `select count(*)::int as total from invitations where org_id = $1`,
    [orgId]
  );
  return rows[0]?.total ?? 0;
}

export async function listInvitations(
  pool: Pool,
  orgId: string,
  limit: number,
  offset: number
): Promise<Invitation[]> {
  const { rows } = await pool.query(
    `select i.id, i.email, i.role, i.token, i.invited_by,
            u.name as inviter_name, i.accepted_at, i.created_at
       from invitations i
       left join users u on u.id = i.invited_by
      where i.org_id = $1
      order by i.created_at desc
      limit $2 offset $3`,
    [orgId, limit, offset]
  );
  return rows.map(toInvitation);
}

export async function getInvitation(
  pool: Pool,
  orgId: string,
  invitationId: string
): Promise<Invitation | null> {
  const { rows } = await pool.query(
    `select i.id, i.email, i.role, i.token, i.invited_by,
            u.name as inviter_name, i.accepted_at, i.created_at
       from invitations i
       left join users u on u.id = i.invited_by
      where i.org_id = $1 and i.id = $2`,
    [orgId, invitationId]
  );
  return rows.length ? toInvitation(rows[0]) : null;
}

interface OrgSettingsRow {
  id: string;
  name: string;
  slug: string;
  default_member_role: Role;
  require_review: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

function toOrgSettings(row: OrgSettingsRow): OrgSettings {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    defaultMemberRole: row.default_member_role,
    requireReview: row.require_review,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

// Loads org + settings, creating a default settings row on first read so the
// caller always gets a complete OrgSettings object.
export async function getOrgSettings(
  pool: Pool,
  orgId: string
): Promise<OrgSettings | null> {
  await pool.query(
    `insert into org_settings (org_id)
       values ($1)
     on conflict (org_id) do nothing`,
    [orgId]
  );
  const { rows } = await pool.query(
    `select o.id, o.name, o.slug,
            s.default_member_role, s.require_review,
            o.created_at, o.updated_at
       from orgs o
       join org_settings s on s.org_id = o.id
      where o.id = $1`,
    [orgId]
  );
  return rows.length ? toOrgSettings(rows[0]) : null;
}

export interface OrgUpdateFields {
  name?: string;
  slug?: string;
  default_member_role?: Role;
  require_review?: boolean;
}

// Applies partial updates to orgs and org_settings inside a single transaction.
// Returns null on a slug collision so the route can respond with 409.
export async function updateOrgSettings(
  pool: Pool,
  orgId: string,
  fields: OrgUpdateFields
): Promise<OrgSettings | null | "slug_taken"> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into org_settings (org_id) values ($1)
       on conflict (org_id) do nothing`,
      [orgId]
    );

    if (fields.slug !== undefined) {
      const { rows: clash } = await client.query(
        `select 1 from orgs where slug = $1 and id <> $2 limit 1`,
        [fields.slug, orgId]
      );
      if (clash.length > 0) {
        await client.query("rollback");
        return "slug_taken";
      }
    }

    if (fields.name !== undefined || fields.slug !== undefined) {
      await client.query(
        `update orgs
            set name = coalesce($2, name),
                slug = coalesce($3, slug),
                updated_at = now()
          where id = $1`,
        [orgId, fields.name ?? null, fields.slug ?? null]
      );
    }

    if (
      fields.default_member_role !== undefined ||
      fields.require_review !== undefined
    ) {
      await client.query(
        `update org_settings
            set default_member_role = coalesce($2, default_member_role),
                require_review = coalesce($3, require_review),
                updated_at = now()
          where org_id = $1`,
        [
          orgId,
          fields.default_member_role ?? null,
          fields.require_review ?? null,
        ]
      );
    }

    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  return getOrgSettings(pool, orgId);
}
