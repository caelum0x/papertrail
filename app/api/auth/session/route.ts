import { getPool } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth/session";
import { ok, fail } from "@/lib/api/response";
import type { Role } from "@/lib/authz/rbac";

export const runtime = "nodejs";

export interface SessionOrg {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

export interface SessionPayload {
  user: { id: string; email: string; name: string | null };
  orgs: SessionOrg[];
}

export async function GET(): Promise<Response> {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return fail("Not authenticated.", 401);
    }
    const pool = getPool();
    const userRes = await pool.query(
      `select id, email, name from users where id = $1`,
      [userId]
    );
    if (userRes.rows.length === 0) {
      return fail("Not authenticated.", 401);
    }
    const user = userRes.rows[0];

    const orgsRes = await pool.query(
      `select o.id, o.name, o.slug, m.role
         from memberships m
         join orgs o on o.id = m.org_id
        where m.user_id = $1
        order by m.created_at asc`,
      [userId]
    );

    const payload: SessionPayload = {
      user: { id: user.id, email: user.email, name: user.name ?? null },
      orgs: orgsRes.rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        role: r.role as Role,
      })),
    };
    return ok(payload);
  } catch {
    return fail("Failed to load session.", 500);
  }
}
