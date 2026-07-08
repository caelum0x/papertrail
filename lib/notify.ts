import type { Pool } from "pg";
import { z } from "zod";
import { getPool } from "@/lib/db";

// In-app notifications. `notify()` is the single entry point other modules call
// to enqueue a notification for a recipient; it respects the recipient's
// per-type preferences (an opted-out type is silently dropped) and never throws
// — delivery is best-effort so it can be fired from inside a mutation without
// risking the originating request.

// Known notification types. `type` is stored as free text in the DB so new
// categories can be added without a migration, but these are the built-ins the
// UI knows how to render/label.
export const NOTIFICATION_TYPES = [
  "review_assigned",
  "review_decided",
  "claim_verified",
  "document_processed",
  "member_invited",
  "export_ready",
  "system",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number] | string;

// A notification as returned to the client (camelCase, ISO timestamps).
export interface Notification {
  id: string;
  orgId: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

// Recipient delivery preferences: a map of notification type -> enabled.
export interface NotificationPrefs {
  prefs: Record<string, boolean>;
  updatedAt: string | null;
}

// Payload for notify(). type/title are required; body/link are optional.
export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
}

// Zod schema for validating a PATCH to notification prefs at the API boundary.
export const updatePrefsSchema = z.object({
  prefs: z.record(z.string(), z.boolean()),
});

export type UpdatePrefsInput = z.infer<typeof updatePrefsSchema>;

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

interface NotificationRow {
  id: string;
  org_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: Date | string | null;
  created_at: Date | string;
}

function mapNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    readAt: toIso(row.read_at),
    createdAt: toIso(row.created_at) as string,
  };
}

// Returns true when the recipient wants to receive `type`. A missing prefs row,
// or a type absent from the map, defaults to enabled.
async function isTypeEnabled(
  pool: Pool,
  orgId: string,
  userId: string,
  type: string
): Promise<boolean> {
  const { rows } = await pool.query<{ prefs: Record<string, unknown> }>(
    `select prefs from notification_prefs
      where org_id = $1 and user_id = $2
      limit 1`,
    [orgId, userId]
  );
  if (rows.length === 0) return true;
  const value = rows[0].prefs?.[type];
  return value === undefined ? true : value === true;
}

// Enqueue an in-app notification for one recipient. Best-effort: honors the
// recipient's opt-out prefs and swallows its own errors so callers (often inside
// a mutation) are never broken by a notification failure. Returns the created
// notification, or null if it was suppressed or failed.
export async function notify(
  orgId: string,
  userId: string,
  input: NotifyInput
): Promise<Notification | null> {
  try {
    const pool = getPool();
    const enabled = await isTypeEnabled(pool, orgId, userId, input.type);
    if (!enabled) return null;

    const { rows } = await pool.query<NotificationRow>(
      `insert into notifications (org_id, user_id, type, title, body, link)
       values ($1, $2, $3, $4, $5, $6)
       returning id, org_id, user_id, type, title, body, link, read_at, created_at`,
      [
        orgId,
        userId,
        input.type,
        input.title,
        input.body ?? null,
        input.link ?? null,
      ]
    );
    return rows.length > 0 ? mapNotification(rows[0]) : null;
  } catch {
    // Notification delivery is best-effort and must never fail the caller.
    return null;
  }
}

// Count notifications for a recipient in an org. When unreadOnly is true, only
// notifications with a null read_at are counted (drives the bell badge).
export async function countNotifications(
  pool: Pool,
  orgId: string,
  userId: string,
  unreadOnly: boolean
): Promise<number> {
  const where = unreadOnly ? "and read_at is null" : "";
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::int as count from notifications
      where org_id = $1 and user_id = $2 ${where}`,
    [orgId, userId]
  );
  return Number(rows[0]?.count ?? 0);
}

// Paginated newest-first feed for a recipient. unreadOnly filters to unread.
export async function listNotifications(
  pool: Pool,
  orgId: string,
  userId: string,
  unreadOnly: boolean,
  limit: number,
  offset: number
): Promise<Notification[]> {
  const where = unreadOnly ? "and read_at is null" : "";
  const { rows } = await pool.query<NotificationRow>(
    `select id, org_id, user_id, type, title, body, link, read_at, created_at
       from notifications
      where org_id = $1 and user_id = $2 ${where}
      order by created_at desc
      limit $3 offset $4`,
    [orgId, userId, limit, offset]
  );
  return rows.map(mapNotification);
}

// Mark one notification read. Org- and user-scoped so a recipient can only touch
// their own rows. Returns the updated notification, or null if not found.
export async function markRead(
  pool: Pool,
  orgId: string,
  userId: string,
  id: string
): Promise<Notification | null> {
  const { rows } = await pool.query<NotificationRow>(
    `update notifications
        set read_at = coalesce(read_at, now())
      where org_id = $1 and user_id = $2 and id = $3
      returning id, org_id, user_id, type, title, body, link, read_at, created_at`,
    [orgId, userId, id]
  );
  return rows.length > 0 ? mapNotification(rows[0]) : null;
}

// Mark every unread notification for a recipient read. Returns the count marked.
export async function markAllRead(
  pool: Pool,
  orgId: string,
  userId: string
): Promise<number> {
  const { rowCount } = await pool.query(
    `update notifications set read_at = now()
      where org_id = $1 and user_id = $2 and read_at is null`,
    [orgId, userId]
  );
  return rowCount ?? 0;
}

// Read a recipient's delivery preferences. A missing row yields an empty map
// (receive everything).
export async function getPrefs(
  pool: Pool,
  orgId: string,
  userId: string
): Promise<NotificationPrefs> {
  const { rows } = await pool.query<{
    prefs: Record<string, boolean>;
    created_at: Date | string;
  }>(
    `select prefs, created_at from notification_prefs
      where org_id = $1 and user_id = $2
      limit 1`,
    [orgId, userId]
  );
  if (rows.length === 0) {
    return { prefs: {}, updatedAt: null };
  }
  return { prefs: rows[0].prefs ?? {}, updatedAt: toIso(rows[0].created_at) };
}

// Upsert a recipient's delivery preferences (full replace of the prefs map).
export async function upsertPrefs(
  pool: Pool,
  orgId: string,
  userId: string,
  prefs: Record<string, boolean>
): Promise<NotificationPrefs> {
  const { rows } = await pool.query<{
    prefs: Record<string, boolean>;
    created_at: Date | string;
  }>(
    `insert into notification_prefs (org_id, user_id, prefs)
     values ($1, $2, $3::jsonb)
     on conflict (org_id, user_id)
     do update set prefs = excluded.prefs
     returning prefs, created_at`,
    [orgId, userId, JSON.stringify(prefs)]
  );
  return { prefs: rows[0]?.prefs ?? prefs, updatedAt: toIso(rows[0]?.created_at) };
}
