import type { Pool } from "pg";
import type {
  Tag,
  TagTreeNode,
  Tagging,
  TagUsage,
  TagUsageGroup,
} from "@/lib/tags/types";

// Data-access layer for Tags & taxonomy. Every query is org-scoped: callers pass
// ctx.org.id so a tenant can never read or mutate another tenant's rows.

interface TagRow {
  id: string;
  org_id: string;
  name: string;
  color: string;
  parent_id: string | null;
  usage_count?: string | number | null;
  created_at: Date | string;
}

interface TaggingRow {
  id: string;
  org_id: string;
  tag_id: string;
  entity_type: string;
  entity_id: string;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapTag(row: TagRow): Tag {
  const tag: Tag = {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    color: row.color,
    parentId: row.parent_id,
    createdAt: toIso(row.created_at),
  };
  if (row.usage_count !== undefined && row.usage_count !== null) {
    tag.usageCount = Number(row.usage_count);
  }
  return tag;
}

function mapTagging(row: TaggingRow): Tagging {
  return {
    id: row.id,
    orgId: row.org_id,
    tagId: row.tag_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    createdAt: toIso(row.created_at),
  };
}

export interface TagFilters {
  parentId?: string;
  search?: string;
}

// Builds the shared WHERE clause + params for list/count. params[0] is org id.
function buildTagWhere(orgId: string, filters: TagFilters): {
  clause: string;
  params: unknown[];
} {
  const params: unknown[] = [orgId];
  let clause = "t.org_id = $1";
  if (filters.parentId) {
    params.push(filters.parentId);
    clause += ` and t.parent_id = $${params.length}`;
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    clause += ` and t.name ilike $${params.length}`;
  }
  return { clause, params };
}

export async function listTags(
  pool: Pool,
  orgId: string,
  filters: TagFilters,
  limit: number,
  offset: number
): Promise<Tag[]> {
  const { clause, params } = buildTagWhere(orgId, filters);
  params.push(limit, offset);
  const { rows } = await pool.query<TagRow>(
    `select t.id, t.org_id, t.name, t.color, t.parent_id, t.created_at,
            count(tg.id)::int as usage_count
       from tags t
       left join taggings tg on tg.tag_id = t.id
      where ${clause}
      group by t.id
      order by t.name asc
      limit $${params.length - 1} offset $${params.length}`,
    params
  );
  return rows.map(mapTag);
}

export async function countTags(
  pool: Pool,
  orgId: string,
  filters: TagFilters
): Promise<number> {
  const { clause, params } = buildTagWhere(orgId, filters);
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count from tags t where ${clause}`,
    params
  );
  return Number(rows[0]?.count ?? 0);
}

export async function getTag(
  pool: Pool,
  orgId: string,
  id: string
): Promise<Tag | null> {
  const { rows } = await pool.query<TagRow>(
    `select t.id, t.org_id, t.name, t.color, t.parent_id, t.created_at,
            count(tg.id)::int as usage_count
       from tags t
       left join taggings tg on tg.tag_id = t.id
      where t.org_id = $1 and t.id = $2
      group by t.id`,
    [orgId, id]
  );
  return rows[0] ? mapTag(rows[0]) : null;
}

// Case-insensitive name lookup used to enforce the uniqueness constraint with a
// friendly error before hitting the DB unique index.
export async function findTagByName(
  pool: Pool,
  orgId: string,
  name: string
): Promise<Tag | null> {
  const { rows } = await pool.query<TagRow>(
    `select id, org_id, name, color, parent_id, created_at
       from tags
      where org_id = $1 and lower(name) = lower($2)
      limit 1`,
    [orgId, name]
  );
  return rows[0] ? mapTag(rows[0]) : null;
}

export interface CreateTagArgs {
  orgId: string;
  name: string;
  color: string;
  parentId: string | null;
}

export async function createTag(
  pool: Pool,
  args: CreateTagArgs
): Promise<Tag> {
  const { rows } = await pool.query<TagRow>(
    `insert into tags (org_id, name, color, parent_id)
     values ($1, $2, $3, $4)
     returning id, org_id, name, color, parent_id, created_at`,
    [args.orgId, args.name, args.color, args.parentId]
  );
  return mapTag(rows[0]);
}

export interface UpdateTagArgs {
  name?: string;
  color?: string;
  parentId?: string | null;
}

export async function updateTag(
  pool: Pool,
  orgId: string,
  id: string,
  args: UpdateTagArgs
): Promise<Tag | null> {
  const sets: string[] = [];
  const params: unknown[] = [orgId, id];
  if (args.name !== undefined) {
    params.push(args.name);
    sets.push(`name = $${params.length}`);
  }
  if (args.color !== undefined) {
    params.push(args.color);
    sets.push(`color = $${params.length}`);
  }
  if (args.parentId !== undefined) {
    params.push(args.parentId);
    sets.push(`parent_id = $${params.length}`);
  }
  if (sets.length === 0) {
    return getTag(pool, orgId, id);
  }
  const { rows } = await pool.query<TagRow>(
    `update tags set ${sets.join(", ")}
      where org_id = $1 and id = $2
      returning id, org_id, name, color, parent_id, created_at`,
    params
  );
  return rows[0] ? mapTag(rows[0]) : null;
}

export async function deleteTag(
  pool: Pool,
  orgId: string,
  id: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `delete from tags where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return (rowCount ?? 0) > 0;
}

// Would setting `candidateParent` as the parent of `tagId` create a cycle?
// Walks up from the candidate parent to the root; if we reach tagId, it's a cycle.
export async function wouldCreateCycle(
  pool: Pool,
  orgId: string,
  tagId: string,
  candidateParentId: string
): Promise<boolean> {
  let current: string | null = candidateParentId;
  const seen = new Set<string>();
  while (current) {
    if (current === tagId) {
      return true;
    }
    if (seen.has(current)) {
      // Defensive: an existing cycle in data shouldn't loop forever.
      return true;
    }
    seen.add(current);
    const { rows }: { rows: { parent_id: string | null }[] } = await pool.query(
      `select parent_id from tags where org_id = $1 and id = $2`,
      [orgId, current]
    );
    current = rows[0]?.parent_id ?? null;
  }
  return false;
}

// Loads every tag for the org (with usage counts) and assembles a nested tree.
// Orphaned tags (parent no longer in set) are surfaced at the root so nothing is
// silently hidden.
export async function getTagTree(
  pool: Pool,
  orgId: string
): Promise<TagTreeNode[]> {
  const { rows } = await pool.query<TagRow>(
    `select t.id, t.org_id, t.name, t.color, t.parent_id, t.created_at,
            count(tg.id)::int as usage_count
       from tags t
       left join taggings tg on tg.tag_id = t.id
      where t.org_id = $1
      group by t.id
      order by t.name asc`,
    [orgId]
  );

  const nodes = new Map<string, TagTreeNode>();
  for (const row of rows) {
    nodes.set(row.id, { ...mapTag(row), children: [] });
  }

  const roots: TagTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// --- Taggings ---------------------------------------------------------------

export interface AttachTaggingArgs {
  orgId: string;
  tagId: string;
  entityType: string;
  entityId: string;
}

// Idempotent attach: on conflict returns the existing row so re-attaching is safe.
export async function attachTagging(
  pool: Pool,
  args: AttachTaggingArgs
): Promise<Tagging> {
  const { rows } = await pool.query<TaggingRow>(
    `insert into taggings (org_id, tag_id, entity_type, entity_id)
     values ($1, $2, $3, $4)
     on conflict (org_id, tag_id, entity_type, entity_id)
       do update set org_id = excluded.org_id
     returning id, org_id, tag_id, entity_type, entity_id, created_at`,
    [args.orgId, args.tagId, args.entityType, args.entityId]
  );
  return mapTagging(rows[0]);
}

export async function detachTagging(
  pool: Pool,
  orgId: string,
  tagId: string,
  entityType: string,
  entityId: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `delete from taggings
      where org_id = $1 and tag_id = $2 and entity_type = $3 and entity_id = $4`,
    [orgId, tagId, entityType, entityId]
  );
  return (rowCount ?? 0) > 0;
}

// Lists tags attached to a specific entity (used by TagPicker in other modules).
export async function listTagsForEntity(
  pool: Pool,
  orgId: string,
  entityType: string,
  entityId: string
): Promise<Tag[]> {
  const { rows } = await pool.query<TagRow>(
    `select t.id, t.org_id, t.name, t.color, t.parent_id, t.created_at
       from taggings tg
       join tags t on t.id = tg.tag_id
      where tg.org_id = $1 and tg.entity_type = $2 and tg.entity_id = $3
      order by t.name asc`,
    [orgId, entityType, entityId]
  );
  return rows.map(mapTag);
}

// Usage breakdown for one tag: total, per-entity-type counts, and recent rows.
export async function getTagUsage(
  pool: Pool,
  orgId: string,
  tagId: string,
  limit: number
): Promise<TagUsage> {
  const [groupRes, taggingRes] = await Promise.all([
    pool.query<{ entity_type: string; count: string }>(
      `select entity_type, count(*)::text as count
         from taggings
        where org_id = $1 and tag_id = $2
        group by entity_type
        order by count(*) desc`,
      [orgId, tagId]
    ),
    pool.query<TaggingRow>(
      `select id, org_id, tag_id, entity_type, entity_id, created_at
         from taggings
        where org_id = $1 and tag_id = $2
        order by created_at desc
        limit $3`,
      [orgId, tagId, limit]
    ),
  ]);

  const groups: TagUsageGroup[] = groupRes.rows.map((r) => ({
    entityType: r.entity_type,
    count: Number(r.count),
  }));
  const total = groups.reduce((sum, g) => sum + g.count, 0);
  return { total, groups, taggings: taggingRes.rows.map(mapTagging) };
}
