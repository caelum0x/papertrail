import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth/session";
import { fail } from "@/lib/api/response";
import type { Role, RbacError } from "@/lib/authz/rbac";

// Request context resolved by withOrg: the authenticated user, their current
// org, and their role within it. Every org-scoped route filters by ctx.org.id.
export interface Ctx {
  user: { id: string; email: string; name: string | null };
  org: { id: string; name: string; slug: string };
  role: Role;
}

export interface Pagination {
  limit: number;
  offset: number;
  page: number;
}

// Next 15+ delivers dynamic-route params as a Promise. The wrapper awaits it and
// hands inner handlers the RESOLVED params, so route handlers stay unchanged.
type RouteContext = { params?: Promise<Record<string, string>> };
type ResolvedParams = Record<string, string> | undefined;

function isRbacError(err: unknown): err is RbacError {
  return (
    err instanceof Error &&
    typeof (err as { status?: unknown }).status === "number"
  );
}

// Parses ?page & ?limit into limit/offset/page. limit clamped to 1..100 (default 20).
export function parsePagination(req: NextRequest): Pagination {
  const url = new URL(req.url);
  const rawPage = Number(url.searchParams.get("page"));
  const rawLimit = Number(url.searchParams.get("limit"));

  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const limitCandidate =
    Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.floor(rawLimit) : 20;
  const limit = Math.min(Math.max(limitCandidate, 1), 100);
  const offset = (page - 1) * limit;

  return { limit, offset, page };
}

async function loadUser(userId: string): Promise<Ctx["user"] | null> {
  const { rows } = await getPool().query(
    `select id, email, name from users where id = $1`,
    [userId]
  );
  if (rows.length === 0) {
    return null;
  }
  const row = rows[0];
  return { id: row.id, email: row.email, name: row.name ?? null };
}

// Resolves the org the request targets: 'x-org-id' header if the user is a
// member of it, otherwise the user's earliest-joined membership as default.
async function resolveOrg(
  userId: string,
  requestedOrgId: string | null
): Promise<{ org: Ctx["org"]; role: Role } | null> {
  const params: unknown[] = [userId];
  let where = "m.user_id = $1";
  if (requestedOrgId) {
    where += " and m.org_id = $2";
    params.push(requestedOrgId);
  }
  const { rows } = await getPool().query(
    `select o.id, o.name, o.slug, m.role
       from memberships m
       join orgs o on o.id = m.org_id
      where ${where}
      order by m.created_at asc
      limit 1`,
    params
  );
  if (rows.length === 0) {
    return null;
  }
  const row = rows[0];
  return {
    org: { id: row.id, name: row.name, slug: row.slug },
    role: row.role as Role,
  };
}

// Wraps an org-scoped route handler. Resolves session -> user -> current org
// membership. 401 if no valid session, 403 if the user has no access to the org.
export function withOrg(
  fn: (req: NextRequest, ctx: Ctx, params: ResolvedParams) => Promise<Response>
): (req: NextRequest, ctx: RouteContext) => Promise<Response> {
  return async (req: NextRequest, routeCtx: RouteContext) => {
    try {
      const userId = await getSessionUserId();
      if (!userId) {
        return fail("Not authenticated.", 401);
      }
      const user = await loadUser(userId);
      if (!user) {
        return fail("Not authenticated.", 401);
      }
      const requestedOrgId = req.headers.get("x-org-id");
      const resolved = await resolveOrg(userId, requestedOrgId);
      if (!resolved) {
        return fail("No access to this organization.", 403);
      }
      const ctx: Ctx = { user, org: resolved.org, role: resolved.role };
      const params = routeCtx.params ? await routeCtx.params : undefined;
      return await fn(req, ctx, params);
    } catch (err: unknown) {
      if (isRbacError(err)) {
        return fail(err.message, err.status);
      }
      return fail("Internal server error.", 500);
    }
  };
}

// Wraps an auth-only route handler (no org resolution). 401 if no valid session.
export function withAuth(
  fn: (
    req: NextRequest,
    user: Ctx["user"],
    params: ResolvedParams
  ) => Promise<Response>
): (req: NextRequest, ctx: RouteContext) => Promise<Response> {
  return async (req: NextRequest, routeCtx: RouteContext) => {
    try {
      const userId = await getSessionUserId();
      if (!userId) {
        return fail("Not authenticated.", 401);
      }
      const user = await loadUser(userId);
      if (!user) {
        return fail("Not authenticated.", 401);
      }
      const params = routeCtx.params ? await routeCtx.params : undefined;
      return await fn(req, user, params);
    } catch (err: unknown) {
      if (isRbacError(err)) {
        return fail(err.message, err.status);
      }
      return fail("Internal server error.", 500);
    }
  };
}
