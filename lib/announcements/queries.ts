import type { Pool } from "pg";
import type {
  Announcement,
  AnnouncementAudience,
  AnnouncementKind,
  AnnouncementRead,
  Release,
} from "@/lib/announcements/types";

// Data-access layer for Announcements, releases & changelog. Every query is
// org-scoped: callers pass ctx.org.id so a tenant can never read or mutate
// another tenant's rows.

interface AnnouncementRow {
  id: string;
  org_id: string;
  title: string;
  body: string;
  kind: string;
  audience: string;
  published_at: Date | string | null;
  created_by: string | null;
  created_at: Date | string;
  author_name?: string | null;
  author_email?: string | null;
  read_at?: Date | string | null;
}

interface ReleaseRow {
  id: string;
  org_id: string;
  version: string;
  notes: string;
  released_at: Date | string;
  created_at: Date | string;
}

interface ReadRow {
  id: string;
  org_id: string;
  user_id: string;
  announcement_id: string;
  read_at: Date | string;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  return value === null || value === undefined ? null : toIso(value);
}

function mapAnnouncement(row: AnnouncementRow): Announcement {
  const a: Announcement = {
    id: row.id,
    orgId: row.org_id,
    title: row.title,
    body: row.body,
    kind: row.kind as AnnouncementKind,
    audience: row.audience as AnnouncementAudience,
    publishedAt: toIsoOrNull(row.published_at),
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
  };
  if (row.author_name !== undefined) a.authorName = row.author_name ?? null;
  if (row.author_email !== undefined) a.authorEmail = row.author_email ?? null;
  if (row.read_at !== undefined) a.read = row.read_at !== null;
  return a;
}

function mapRelease(row: ReleaseRow): Release {
  return {
    id: row.id,
    orgId: row.org_id,
    version: row.version,
    notes: row.notes,
    releasedAt: toIso(row.released_at),
    createdAt: toIso(row.created_at),
  };
}

function mapRead(row: ReadRow): AnnouncementRead {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    announcementId: row.announcement_id,
    readAt: toIso(row.read_at),
    createdAt: toIso(row.created_at),
  };
}

// --- Announcements ----------------------------------------------------------

export interface AnnouncementFilters {
  kind?: AnnouncementKind;
  // When true, only return published announcements (member-facing feed).
  publishedOnly?: boolean;
  search?: string;
}

// Builds the shared WHERE clause + params for list/count. params[0] is org id.
function buildWhere(
  orgId: string,
  filters: AnnouncementFilters
): { clause: string; params: unknown[] } {
  const params: unknown[] = [orgId];
  let clause = "a.org_id = $1";
  if (filters.publishedOnly) {
    clause += " and a.published_at is not null";
  }
  if (filters.kind) {
    params.push(filters.kind);
    clause += ` and a.kind = $${params.length}`;
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    clause += ` and (a.title ilike $${params.length} or a.body ilike $${params.length})`;
  }
  return { clause, params };
}

// Lists announcements for an org, newest first, joined to the author and to the
// given user's read state so the UI can badge unread items in one round-trip.
export async function listAnnouncements(
  pool: Pool,
  orgId: string,
  userId: string,
  filters: AnnouncementFilters,
  limit: number,
  offset: number
): Promise<Announcement[]> {
  const { clause, params } = buildWhere(orgId, filters);
  params.push(userId, limit, offset);
  const userParam = params.length - 2;
  const { rows } = await pool.query<AnnouncementRow>(
    `select a.id, a.org_id, a.title, a.body, a.kind, a.audience,
            a.published_at, a.created_by, a.created_at,
            u.name as author_name, u.email as author_email,
            r.read_at as read_at
       from announcements a
       left join users u on u.id = a.created_by
       left join announcement_reads r
         on r.announcement_id = a.id and r.user_id = $${userParam}
      where ${clause}
      order by coalesce(a.published_at, a.created_at) desc, a.created_at desc
      limit $${params.length - 1} offset $${params.length}`,
    params
  );
  return rows.map(mapAnnouncement);
}

export async function countAnnouncements(
  pool: Pool,
  orgId: string,
  filters: AnnouncementFilters
): Promise<number> {
  const { clause, params } = buildWhere(orgId, filters);
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count from announcements a where ${clause}`,
    params
  );
  return Number(rows[0]?.count ?? 0);
}

export async function getAnnouncement(
  pool: Pool,
  orgId: string,
  userId: string,
  id: string
): Promise<Announcement | null> {
  const { rows } = await pool.query<AnnouncementRow>(
    `select a.id, a.org_id, a.title, a.body, a.kind, a.audience,
            a.published_at, a.created_by, a.created_at,
            u.name as author_name, u.email as author_email,
            r.read_at as read_at
       from announcements a
       left join users u on u.id = a.created_by
       left join announcement_reads r
         on r.announcement_id = a.id and r.user_id = $3
      where a.org_id = $1 and a.id = $2`,
    [orgId, id, userId]
  );
  return rows[0] ? mapAnnouncement(rows[0]) : null;
}

export interface CreateAnnouncementArgs {
  orgId: string;
  title: string;
  body: string;
  kind: AnnouncementKind;
  audience: AnnouncementAudience;
  createdBy: string | null;
  publish: boolean;
}

export async function createAnnouncement(
  pool: Pool,
  args: CreateAnnouncementArgs
): Promise<Announcement> {
  const { rows } = await pool.query<AnnouncementRow>(
    `insert into announcements
       (org_id, title, body, kind, audience, created_by, published_at)
     values ($1, $2, $3, $4, $5, $6, ${args.publish ? "now()" : "null"})
     returning id, org_id, title, body, kind, audience,
               published_at, created_by, created_at`,
    [args.orgId, args.title, args.body, args.kind, args.audience, args.createdBy]
  );
  return mapAnnouncement(rows[0]);
}

export interface UpdateAnnouncementArgs {
  title?: string;
  body?: string;
  kind?: AnnouncementKind;
  audience?: AnnouncementAudience;
}

export async function updateAnnouncement(
  pool: Pool,
  orgId: string,
  id: string,
  args: UpdateAnnouncementArgs
): Promise<Announcement | null> {
  const sets: string[] = [];
  const params: unknown[] = [orgId, id];
  if (args.title !== undefined) {
    params.push(args.title);
    sets.push(`title = $${params.length}`);
  }
  if (args.body !== undefined) {
    params.push(args.body);
    sets.push(`body = $${params.length}`);
  }
  if (args.kind !== undefined) {
    params.push(args.kind);
    sets.push(`kind = $${params.length}`);
  }
  if (args.audience !== undefined) {
    params.push(args.audience);
    sets.push(`audience = $${params.length}`);
  }
  if (sets.length === 0) {
    const existing = await pool.query<AnnouncementRow>(
      `select id, org_id, title, body, kind, audience,
              published_at, created_by, created_at
         from announcements where org_id = $1 and id = $2`,
      [orgId, id]
    );
    return existing.rows[0] ? mapAnnouncement(existing.rows[0]) : null;
  }
  const { rows } = await pool.query<AnnouncementRow>(
    `update announcements set ${sets.join(", ")}
      where org_id = $1 and id = $2
      returning id, org_id, title, body, kind, audience,
                published_at, created_by, created_at`,
    params
  );
  return rows[0] ? mapAnnouncement(rows[0]) : null;
}

// Publishes a draft by stamping published_at. Idempotent: publishing an already
// published announcement leaves its original published_at unchanged.
export async function publishAnnouncement(
  pool: Pool,
  orgId: string,
  id: string
): Promise<Announcement | null> {
  const { rows } = await pool.query<AnnouncementRow>(
    `update announcements
        set published_at = coalesce(published_at, now())
      where org_id = $1 and id = $2
      returning id, org_id, title, body, kind, audience,
                published_at, created_by, created_at`,
    [orgId, id]
  );
  return rows[0] ? mapAnnouncement(rows[0]) : null;
}

export async function deleteAnnouncement(
  pool: Pool,
  orgId: string,
  id: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `delete from announcements where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return (rowCount ?? 0) > 0;
}

// Idempotent mark-as-read: on conflict keeps the original read_at so re-reading
// is a no-op. Returns the read row.
export async function markAnnouncementRead(
  pool: Pool,
  orgId: string,
  userId: string,
  announcementId: string
): Promise<AnnouncementRead> {
  const { rows } = await pool.query<ReadRow>(
    `insert into announcement_reads (org_id, user_id, announcement_id)
     values ($1, $2, $3)
     on conflict (org_id, user_id, announcement_id)
       do update set org_id = excluded.org_id
     returning id, org_id, user_id, announcement_id, read_at, created_at`,
    [orgId, userId, announcementId]
  );
  return mapRead(rows[0]);
}

// Count of published announcements the given user has not yet read (drives the
// banner / unread badge). Only published items count toward unread.
export async function countUnread(
  pool: Pool,
  orgId: string,
  userId: string
): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from announcements a
       left join announcement_reads r
         on r.announcement_id = a.id and r.user_id = $2
      where a.org_id = $1
        and a.published_at is not null
        and r.id is null`,
    [orgId, userId]
  );
  return Number(rows[0]?.count ?? 0);
}

// The single most recent unread published announcement, for the banner. Returns
// null when the user is caught up.
export async function getLatestUnread(
  pool: Pool,
  orgId: string,
  userId: string
): Promise<Announcement | null> {
  const { rows } = await pool.query<AnnouncementRow>(
    `select a.id, a.org_id, a.title, a.body, a.kind, a.audience,
            a.published_at, a.created_by, a.created_at,
            u.name as author_name, u.email as author_email,
            r.read_at as read_at
       from announcements a
       left join users u on u.id = a.created_by
       left join announcement_reads r
         on r.announcement_id = a.id and r.user_id = $2
      where a.org_id = $1
        and a.published_at is not null
        and r.id is null
      order by a.published_at desc
      limit 1`,
    [orgId, userId]
  );
  return rows[0] ? mapAnnouncement(rows[0]) : null;
}

// --- Releases ---------------------------------------------------------------

export async function listReleases(
  pool: Pool,
  orgId: string,
  limit: number,
  offset: number
): Promise<Release[]> {
  const { rows } = await pool.query<ReleaseRow>(
    `select id, org_id, version, notes, released_at, created_at
       from releases
      where org_id = $1
      order by released_at desc, created_at desc
      limit $2 offset $3`,
    [orgId, limit, offset]
  );
  return rows.map(mapRelease);
}

export async function countReleases(
  pool: Pool,
  orgId: string
): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count from releases where org_id = $1`,
    [orgId]
  );
  return Number(rows[0]?.count ?? 0);
}

export async function findReleaseByVersion(
  pool: Pool,
  orgId: string,
  version: string
): Promise<Release | null> {
  const { rows } = await pool.query<ReleaseRow>(
    `select id, org_id, version, notes, released_at, created_at
       from releases
      where org_id = $1 and lower(version) = lower($2)
      limit 1`,
    [orgId, version]
  );
  return rows[0] ? mapRelease(rows[0]) : null;
}

export interface CreateReleaseArgs {
  orgId: string;
  version: string;
  notes: string;
  releasedAt: string | null;
}

export async function createRelease(
  pool: Pool,
  args: CreateReleaseArgs
): Promise<Release> {
  const { rows } = await pool.query<ReleaseRow>(
    `insert into releases (org_id, version, notes, released_at)
     values ($1, $2, $3, coalesce($4::timestamptz, now()))
     returning id, org_id, version, notes, released_at, created_at`,
    [args.orgId, args.version, args.notes, args.releasedAt]
  );
  return mapRelease(rows[0]);
}
