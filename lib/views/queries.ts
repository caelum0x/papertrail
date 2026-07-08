import type { Pool } from "pg";
import type {
  SavedView,
  ViewQuery,
  ViewResource,
  ViewQueryInput,
} from "@/lib/views/types";

// Data-access layer for Saved views. Every query is org-scoped: callers pass
// ctx.org.id so a tenant can never read or mutate another tenant's rows.
//
// Visibility rule: a user sees their own views plus any `shared` views owned by
// other members of the same org. Only the owner may mutate/delete a view.

interface ViewRow {
  id: string;
  org_id: string;
  user_id: string;
  name: string;
  resource: string;
  query: unknown;
  shared: boolean;
  owner_name?: string | null;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// The jsonb column round-trips as an already-parsed object via node-postgres.
// Guard against nulls / legacy rows so downstream code always gets arrays.
function normalizeQuery(raw: unknown): ViewQuery {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const filters = Array.isArray(obj.filters) ? (obj.filters as ViewQuery["filters"]) : [];
  const sort = Array.isArray(obj.sort) ? (obj.sort as ViewQuery["sort"]) : [];
  const search = typeof obj.search === "string" ? obj.search : undefined;
  return { search, filters, sort };
}

function mapView(row: ViewRow, currentUserId: string): SavedView {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    name: row.name,
    resource: row.resource as ViewResource,
    query: normalizeQuery(row.query),
    shared: row.shared,
    isOwner: row.user_id === currentUserId,
    ownerName: row.owner_name ?? null,
    createdAt: toIso(row.created_at),
  };
}

export interface ViewFilters {
  resource?: string;
}

// WHERE clause + params shared by list/count. params[0]=org, params[1]=user.
// Visibility: owned by the current user OR shared within the org.
function buildViewWhere(
  orgId: string,
  userId: string,
  filters: ViewFilters
): { clause: string; params: unknown[] } {
  const params: unknown[] = [orgId, userId];
  let clause = "v.org_id = $1 and (v.user_id = $2 or v.shared = true)";
  if (filters.resource) {
    params.push(filters.resource);
    clause += ` and v.resource = $${params.length}`;
  }
  return { clause, params };
}

export async function listViews(
  pool: Pool,
  orgId: string,
  userId: string,
  filters: ViewFilters,
  limit: number,
  offset: number
): Promise<SavedView[]> {
  const { clause, params } = buildViewWhere(orgId, userId, filters);
  params.push(limit, offset);
  const { rows } = await pool.query<ViewRow>(
    `select v.id, v.org_id, v.user_id, v.name, v.resource, v.query, v.shared,
            v.created_at, u.name as owner_name
       from saved_views v
       left join users u on u.id = v.user_id
      where ${clause}
      order by v.created_at desc
      limit $${params.length - 1} offset $${params.length}`,
    params
  );
  return rows.map((r) => mapView(r, userId));
}

export async function countViews(
  pool: Pool,
  orgId: string,
  userId: string,
  filters: ViewFilters
): Promise<number> {
  const { clause, params } = buildViewWhere(orgId, userId, filters);
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count from saved_views v where ${clause}`,
    params
  );
  return Number(rows[0]?.count ?? 0);
}

// Fetch a single view the current user is allowed to see (owned or shared).
export async function getView(
  pool: Pool,
  orgId: string,
  userId: string,
  id: string
): Promise<SavedView | null> {
  const { rows } = await pool.query<ViewRow>(
    `select v.id, v.org_id, v.user_id, v.name, v.resource, v.query, v.shared,
            v.created_at, u.name as owner_name
       from saved_views v
       left join users u on u.id = v.user_id
      where v.org_id = $1 and v.id = $2
        and (v.user_id = $3 or v.shared = true)`,
    [orgId, id, userId]
  );
  return rows[0] ? mapView(rows[0], userId) : null;
}

// Owner-name lookup used to enforce the per-owner unique name with a friendly
// error before hitting the DB unique index.
export async function findViewByName(
  pool: Pool,
  orgId: string,
  userId: string,
  resource: string,
  name: string
): Promise<SavedView | null> {
  const { rows } = await pool.query<ViewRow>(
    `select id, org_id, user_id, name, resource, query, shared, created_at
       from saved_views
      where org_id = $1 and user_id = $2 and resource = $3
        and lower(name) = lower($4)
      limit 1`,
    [orgId, userId, resource, name]
  );
  return rows[0] ? mapView(rows[0], userId) : null;
}

export interface CreateViewArgs {
  orgId: string;
  userId: string;
  name: string;
  resource: ViewResource;
  query: ViewQueryInput;
  shared: boolean;
}

export async function createView(
  pool: Pool,
  args: CreateViewArgs
): Promise<SavedView> {
  const { rows } = await pool.query<ViewRow>(
    `insert into saved_views (org_id, user_id, name, resource, query, shared)
     values ($1, $2, $3, $4, $5::jsonb, $6)
     returning id, org_id, user_id, name, resource, query, shared, created_at`,
    [
      args.orgId,
      args.userId,
      args.name,
      args.resource,
      JSON.stringify(args.query),
      args.shared,
    ]
  );
  return mapView(rows[0], args.userId);
}

export interface UpdateViewArgs {
  name?: string;
  query?: ViewQueryInput;
  shared?: boolean;
}

// Updates a view. Scoped to (org, id, owner) so a non-owner can never mutate a
// shared view they can merely read. Returns null if no such owned row exists.
export async function updateView(
  pool: Pool,
  orgId: string,
  userId: string,
  id: string,
  args: UpdateViewArgs
): Promise<SavedView | null> {
  const sets: string[] = [];
  const params: unknown[] = [orgId, id, userId];
  if (args.name !== undefined) {
    params.push(args.name);
    sets.push(`name = $${params.length}`);
  }
  if (args.query !== undefined) {
    params.push(JSON.stringify(args.query));
    sets.push(`query = $${params.length}::jsonb`);
  }
  if (args.shared !== undefined) {
    params.push(args.shared);
    sets.push(`shared = $${params.length}`);
  }
  if (sets.length === 0) {
    return getView(pool, orgId, userId, id);
  }
  const { rows } = await pool.query<ViewRow>(
    `update saved_views set ${sets.join(", ")}
      where org_id = $1 and id = $2 and user_id = $3
      returning id, org_id, user_id, name, resource, query, shared, created_at`,
    params
  );
  return rows[0] ? mapView(rows[0], userId) : null;
}

// Deletes a view. Owner-only: scoped to (org, id, owner) so a shared view can't
// be deleted by another member.
export async function deleteView(
  pool: Pool,
  orgId: string,
  userId: string,
  id: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `delete from saved_views where org_id = $1 and id = $2 and user_id = $3`,
    [orgId, id, userId]
  );
  return (rowCount ?? 0) > 0;
}
