import { z } from "zod";
import type { Pool } from "pg";

// Shared server-side logic for the collaboration module (comments, annotations,
// activity). Colocated under the comments route tree so the module owns it
// without touching foundation lib/*. All queries are org-scoped by the caller.

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The entities a comment or activity item may attach to. Kept as a closed set
// so we never record activity against an unknown entity type.
export const ENTITY_TYPES = [
  "claim",
  "document",
  "verification",
  "review",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const entityTypeSchema = z.enum(ENTITY_TYPES);

export const listCommentsQuerySchema = z.object({
  entity_type: entityTypeSchema,
  entity_id: z.string().regex(UUID_RE, "Invalid entity_id."),
});

export const createCommentSchema = z.object({
  entityType: entityTypeSchema,
  entityId: z.string().regex(UUID_RE, "Invalid entityId."),
  parentId: z.string().regex(UUID_RE, "Invalid parentId.").nullish(),
  body: z.string().trim().min(1, "Comment body is required.").max(5000),
});

export const updateCommentSchema = z.object({
  body: z.string().trim().min(1, "Comment body is required.").max(5000),
});

export const listAnnotationsQuerySchema = z.object({
  document_id: z.string().regex(UUID_RE, "Invalid document_id."),
});

export const createAnnotationSchema = z.object({
  documentId: z.string().regex(UUID_RE, "Invalid documentId."),
  pageNumber: z.coerce.number().int().min(1, "pageNumber must be >= 1."),
  quote: z.string().trim().min(1, "Quote is required.").max(5000),
  note: z.string().trim().max(5000).nullish(),
});

export const activityQuerySchema = z.object({
  entity_type: entityTypeSchema.optional(),
  entity_id: z.string().regex(UUID_RE, "Invalid entity_id.").optional(),
  actor_id: z.string().regex(UUID_RE, "Invalid actor_id.").optional(),
  verb: z.string().trim().min(1).max(100).optional(),
});

// ---------------------------------------------------------------------------
// View models (camelCase, safe to send to the client)
// ---------------------------------------------------------------------------

export interface Comment {
  id: string;
  orgId: string;
  entityType: string;
  entityId: string;
  parentId: string | null;
  authorId: string;
  authorName: string | null;
  authorEmail: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Annotation {
  id: string;
  orgId: string;
  documentId: string;
  pageNumber: number;
  quote: string;
  note: string | null;
  authorId: string;
  authorName: string | null;
  authorEmail: string | null;
  createdAt: string;
}

export interface ActivityItem {
  id: string;
  orgId: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  verb: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapComment(row: any): Comment {
  return {
    id: row.id,
    orgId: row.org_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    parentId: row.parent_id ?? null,
    authorId: row.author_id,
    authorName: row.author_name ?? null,
    authorEmail: row.author_email ?? null,
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapAnnotation(row: any): Annotation {
  return {
    id: row.id,
    orgId: row.org_id,
    documentId: row.document_id,
    pageNumber: row.page_number,
    quote: row.quote,
    note: row.note ?? null,
    authorId: row.author_id,
    authorName: row.author_name ?? null,
    authorEmail: row.author_email ?? null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapActivity(row: any): ActivityItem {
  return {
    id: row.id,
    orgId: row.org_id,
    actorId: row.actor_id ?? null,
    actorName: row.actor_name ?? null,
    actorEmail: row.actor_email ?? null,
    verb: row.verb,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata:
      row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    createdAt: new Date(row.created_at).toISOString(),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// @mention extraction
// ---------------------------------------------------------------------------

const MENTION_RE = /(?:^|\s)@([a-zA-Z0-9._-]+)/g;

// Pull @handles out of comment/annotation text. Handles map to the local-part
// of a member's email (before the @). Deduplicated, lowercased.
export function extractMentions(text: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(text)) !== null) {
    found.add(m[1].toLowerCase());
  }
  return [...found];
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export async function listComments(
  pool: Pool,
  orgId: string,
  entityType: string,
  entityId: string
): Promise<Comment[]> {
  const { rows } = await pool.query(
    `select c.*, u.name as author_name, u.email as author_email
       from comments c
       left join users u on u.id = c.author_id
      where c.org_id = $1 and c.entity_type = $2 and c.entity_id = $3
      order by c.created_at asc`,
    [orgId, entityType, entityId]
  );
  return rows.map(mapComment);
}

export async function getComment(
  pool: Pool,
  orgId: string,
  id: string
): Promise<Comment | null> {
  const { rows } = await pool.query(
    `select c.*, u.name as author_name, u.email as author_email
       from comments c
       left join users u on u.id = c.author_id
      where c.org_id = $1 and c.id = $2`,
    [orgId, id]
  );
  return rows.length ? mapComment(rows[0]) : null;
}

// Confirms a comment belongs to the org (used to validate parentId threading).
export async function commentExists(
  pool: Pool,
  orgId: string,
  id: string
): Promise<boolean> {
  const { rows } = await pool.query(
    `select 1 from comments where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return rows.length > 0;
}

export async function createComment(
  pool: Pool,
  input: {
    orgId: string;
    entityType: string;
    entityId: string;
    parentId: string | null;
    authorId: string;
    body: string;
  }
): Promise<Comment> {
  const { rows } = await pool.query(
    `insert into comments (org_id, entity_type, entity_id, parent_id, author_id, body)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [
      input.orgId,
      input.entityType,
      input.entityId,
      input.parentId,
      input.authorId,
      input.body,
    ]
  );
  return (await getComment(pool, input.orgId, rows[0].id)) as Comment;
}

export async function updateComment(
  pool: Pool,
  orgId: string,
  id: string,
  body: string
): Promise<Comment | null> {
  const { rows } = await pool.query(
    `update comments set body = $3, updated_at = now()
      where org_id = $1 and id = $2
      returning id`,
    [orgId, id, body]
  );
  if (!rows.length) return null;
  return getComment(pool, orgId, id);
}

export async function deleteComment(
  pool: Pool,
  orgId: string,
  id: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `delete from comments where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return (rowCount ?? 0) > 0;
}

export async function listAnnotations(
  pool: Pool,
  orgId: string,
  documentId: string
): Promise<Annotation[]> {
  const { rows } = await pool.query(
    `select a.*, u.name as author_name, u.email as author_email
       from annotations a
       left join users u on u.id = a.author_id
      where a.org_id = $1 and a.document_id = $2
      order by a.page_number asc, a.created_at asc`,
    [orgId, documentId]
  );
  return rows.map(mapAnnotation);
}

export async function getAnnotation(
  pool: Pool,
  orgId: string,
  id: string
): Promise<Annotation | null> {
  const { rows } = await pool.query(
    `select a.*, u.name as author_name, u.email as author_email
       from annotations a
       left join users u on u.id = a.author_id
      where a.org_id = $1 and a.id = $2`,
    [orgId, id]
  );
  return rows.length ? mapAnnotation(rows[0]) : null;
}

// Confirms a document belongs to the org before anchoring an annotation to it.
export async function documentInOrg(
  pool: Pool,
  orgId: string,
  documentId: string
): Promise<boolean> {
  const { rows } = await pool.query(
    `select 1 from documents where org_id = $1 and id = $2`,
    [orgId, documentId]
  );
  return rows.length > 0;
}

export async function createAnnotation(
  pool: Pool,
  input: {
    orgId: string;
    documentId: string;
    pageNumber: number;
    quote: string;
    note: string | null;
    authorId: string;
  }
): Promise<Annotation> {
  const { rows } = await pool.query(
    `insert into annotations (org_id, document_id, page_number, quote, note, author_id)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [
      input.orgId,
      input.documentId,
      input.pageNumber,
      input.quote,
      input.note,
      input.authorId,
    ]
  );
  return (await getAnnotation(pool, input.orgId, rows[0].id)) as Annotation;
}

export async function deleteAnnotation(
  pool: Pool,
  orgId: string,
  id: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `delete from annotations where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return (rowCount ?? 0) > 0;
}

export async function listActivity(
  pool: Pool,
  orgId: string,
  filters: {
    entityType?: string;
    entityId?: string;
    actorId?: string;
    verb?: string;
  },
  limit: number,
  offset: number
): Promise<{ items: ActivityItem[]; total: number }> {
  const conds: string[] = ["a.org_id = $1"];
  const params: unknown[] = [orgId];
  if (filters.entityType) {
    params.push(filters.entityType);
    conds.push(`a.entity_type = $${params.length}`);
  }
  if (filters.entityId) {
    params.push(filters.entityId);
    conds.push(`a.entity_id = $${params.length}`);
  }
  if (filters.actorId) {
    params.push(filters.actorId);
    conds.push(`a.actor_id = $${params.length}`);
  }
  if (filters.verb) {
    params.push(filters.verb);
    conds.push(`a.verb = $${params.length}`);
  }
  const where = conds.join(" and ");

  const countRes = await pool.query(
    `select count(*)::int as total from activity a where ${where}`,
    params
  );
  const total = countRes.rows[0]?.total ?? 0;

  const listParams = [...params, limit, offset];
  const { rows } = await pool.query(
    `select a.*, u.name as actor_name, u.email as actor_email
       from activity a
       left join users u on u.id = a.actor_id
      where ${where}
      order by a.created_at desc
      limit $${listParams.length - 1} offset $${listParams.length}`,
    listParams
  );
  return { items: rows.map(mapActivity), total };
}

// Records an activity feed entry. Best-effort in the sense that callers wrap it,
// but errors here propagate to the caller's try/catch (unlike audit).
export async function recordActivity(
  pool: Pool,
  input: {
    orgId: string;
    actorId: string | null;
    verb: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await pool.query(
    `insert into activity (org_id, actor_id, verb, entity_type, entity_id, metadata)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      input.orgId,
      input.actorId,
      input.verb,
      input.entityType,
      input.entityId,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
}
