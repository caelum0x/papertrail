import type { Pool } from "pg";
import type {
  HelpArticle,
  HelpCategory,
  SupportTicket,
  TicketMessage,
  FeedbackEntry,
  TicketStatus,
  TicketPriority,
  FeedbackKind,
} from "@/lib/help/types";

// Data-access layer for the Help center / support / feedback module. Every query
// is org-scoped: callers pass ctx.org.id so a tenant can never read or mutate
// another tenant's rows.

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// --- help_articles -----------------------------------------------------------

interface ArticleRow {
  id: string;
  org_id: string;
  slug: string;
  title: string;
  body: string;
  category: string;
  created_at: Date | string;
}

function mapArticle(row: ArticleRow): HelpArticle {
  return {
    id: row.id,
    orgId: row.org_id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    category: row.category,
    createdAt: toIso(row.created_at),
  };
}

export interface ArticleFilters {
  category?: string;
  search?: string;
}

export async function listArticles(
  pool: Pool,
  orgId: string,
  filters: ArticleFilters,
  limit: number,
  offset: number
): Promise<HelpArticle[]> {
  const params: unknown[] = [orgId];
  const where: string[] = ["org_id = $1"];
  if (filters.category) {
    params.push(filters.category);
    where.push(`category = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(`(title ilike $${params.length} or body ilike $${params.length})`);
  }
  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const { rows } = await pool.query<ArticleRow>(
    `select id, org_id, slug, title, body, category, created_at
       from help_articles
      where ${where.join(" and ")}
      order by created_at desc
      limit $${limitIdx} offset $${offsetIdx}`,
    params
  );
  return rows.map(mapArticle);
}

export async function countArticles(
  pool: Pool,
  orgId: string,
  filters: ArticleFilters
): Promise<number> {
  const params: unknown[] = [orgId];
  const where: string[] = ["org_id = $1"];
  if (filters.category) {
    params.push(filters.category);
    where.push(`category = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(`(title ilike $${params.length} or body ilike $${params.length})`);
  }
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count from help_articles where ${where.join(" and ")}`,
    params
  );
  return Number(rows[0]?.count ?? 0);
}

export async function getArticleBySlug(
  pool: Pool,
  orgId: string,
  slug: string
): Promise<HelpArticle | null> {
  const { rows } = await pool.query<ArticleRow>(
    `select id, org_id, slug, title, body, category, created_at
       from help_articles
      where org_id = $1 and lower(slug) = lower($2)
      limit 1`,
    [orgId, slug]
  );
  return rows[0] ? mapArticle(rows[0]) : null;
}

export async function listCategories(
  pool: Pool,
  orgId: string
): Promise<HelpCategory[]> {
  const { rows } = await pool.query<{ category: string; count: string }>(
    `select category, count(*)::text as count
       from help_articles
      where org_id = $1
      group by category
      order by category asc`,
    [orgId]
  );
  return rows.map((r) => ({ category: r.category, count: Number(r.count) }));
}

// --- support_tickets ---------------------------------------------------------

interface TicketRow {
  id: string;
  org_id: string;
  user_id: string;
  subject: string;
  body: string;
  status: string;
  priority: string;
  created_at: Date | string;
  author_name?: string | null;
  author_email?: string | null;
  message_count?: string | number | null;
}

function mapTicket(row: TicketRow): SupportTicket {
  const ticket: SupportTicket = {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    subject: row.subject,
    body: row.body,
    status: row.status as TicketStatus,
    priority: row.priority as TicketPriority,
    createdAt: toIso(row.created_at),
  };
  if (row.author_name !== undefined) ticket.authorName = row.author_name ?? null;
  if (row.author_email !== undefined) ticket.authorEmail = row.author_email ?? null;
  if (row.message_count !== undefined && row.message_count !== null) {
    ticket.messageCount = Number(row.message_count);
  }
  return ticket;
}

export interface TicketFilters {
  status?: TicketStatus;
  priority?: TicketPriority;
  search?: string;
}

export async function listTickets(
  pool: Pool,
  orgId: string,
  filters: TicketFilters,
  limit: number,
  offset: number
): Promise<SupportTicket[]> {
  const params: unknown[] = [orgId];
  const where: string[] = ["t.org_id = $1"];
  if (filters.status) {
    params.push(filters.status);
    where.push(`t.status = $${params.length}`);
  }
  if (filters.priority) {
    params.push(filters.priority);
    where.push(`t.priority = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(`t.subject ilike $${params.length}`);
  }
  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const { rows } = await pool.query<TicketRow>(
    `select t.id, t.org_id, t.user_id, t.subject, t.body, t.status, t.priority,
            t.created_at, u.name as author_name, u.email as author_email,
            (select count(*) from ticket_messages m where m.ticket_id = t.id)::text
              as message_count
       from support_tickets t
       left join users u on u.id = t.user_id
      where ${where.join(" and ")}
      order by t.created_at desc
      limit $${limitIdx} offset $${offsetIdx}`,
    params
  );
  return rows.map(mapTicket);
}

export async function countTickets(
  pool: Pool,
  orgId: string,
  filters: TicketFilters
): Promise<number> {
  const params: unknown[] = [orgId];
  const where: string[] = ["org_id = $1"];
  if (filters.status) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }
  if (filters.priority) {
    params.push(filters.priority);
    where.push(`priority = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(`subject ilike $${params.length}`);
  }
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count from support_tickets where ${where.join(" and ")}`,
    params
  );
  return Number(rows[0]?.count ?? 0);
}

export async function getTicket(
  pool: Pool,
  orgId: string,
  id: string
): Promise<SupportTicket | null> {
  const { rows } = await pool.query<TicketRow>(
    `select t.id, t.org_id, t.user_id, t.subject, t.body, t.status, t.priority,
            t.created_at, u.name as author_name, u.email as author_email
       from support_tickets t
       left join users u on u.id = t.user_id
      where t.org_id = $1 and t.id = $2
      limit 1`,
    [orgId, id]
  );
  return rows[0] ? mapTicket(rows[0]) : null;
}

export async function createTicket(
  pool: Pool,
  input: {
    orgId: string;
    userId: string;
    subject: string;
    body: string;
    priority: TicketPriority;
  }
): Promise<SupportTicket> {
  const { rows } = await pool.query<TicketRow>(
    `insert into support_tickets (org_id, user_id, subject, body, status, priority)
     values ($1, $2, $3, $4, 'open', $5)
     returning id, org_id, user_id, subject, body, status, priority, created_at`,
    [input.orgId, input.userId, input.subject, input.body, input.priority]
  );
  return mapTicket(rows[0]);
}

export async function updateTicket(
  pool: Pool,
  orgId: string,
  id: string,
  patch: { status?: TicketStatus; priority?: TicketPriority }
): Promise<SupportTicket | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.status !== undefined) {
    params.push(patch.status);
    sets.push(`status = $${params.length}`);
  }
  if (patch.priority !== undefined) {
    params.push(patch.priority);
    sets.push(`priority = $${params.length}`);
  }
  if (sets.length === 0) {
    return getTicket(pool, orgId, id);
  }
  params.push(orgId);
  const orgIdx = params.length;
  params.push(id);
  const idIdx = params.length;

  const { rows } = await pool.query<TicketRow>(
    `update support_tickets set ${sets.join(", ")}
      where org_id = $${orgIdx} and id = $${idIdx}
      returning id, org_id, user_id, subject, body, status, priority, created_at`,
    params
  );
  return rows[0] ? mapTicket(rows[0]) : null;
}

// --- ticket_messages ---------------------------------------------------------

interface MessageRow {
  id: string;
  org_id: string;
  ticket_id: string;
  author_id: string;
  body: string;
  created_at: Date | string;
  author_name?: string | null;
  author_email?: string | null;
}

function mapMessage(row: MessageRow): TicketMessage {
  const msg: TicketMessage = {
    id: row.id,
    orgId: row.org_id,
    ticketId: row.ticket_id,
    authorId: row.author_id,
    body: row.body,
    createdAt: toIso(row.created_at),
  };
  if (row.author_name !== undefined) msg.authorName = row.author_name ?? null;
  if (row.author_email !== undefined) msg.authorEmail = row.author_email ?? null;
  return msg;
}

export async function listMessages(
  pool: Pool,
  orgId: string,
  ticketId: string
): Promise<TicketMessage[]> {
  const { rows } = await pool.query<MessageRow>(
    `select m.id, m.org_id, m.ticket_id, m.author_id, m.body, m.created_at,
            u.name as author_name, u.email as author_email
       from ticket_messages m
       left join users u on u.id = m.author_id
      where m.org_id = $1 and m.ticket_id = $2
      order by m.created_at asc`,
    [orgId, ticketId]
  );
  return rows.map(mapMessage);
}

export async function createMessage(
  pool: Pool,
  input: { orgId: string; ticketId: string; authorId: string; body: string }
): Promise<TicketMessage> {
  const { rows } = await pool.query<MessageRow>(
    `insert into ticket_messages (org_id, ticket_id, author_id, body)
     values ($1, $2, $3, $4)
     returning id, org_id, ticket_id, author_id, body, created_at`,
    [input.orgId, input.ticketId, input.authorId, input.body]
  );
  return mapMessage(rows[0]);
}

// --- feedback ----------------------------------------------------------------

interface FeedbackRow {
  id: string;
  org_id: string;
  user_id: string;
  kind: string;
  message: string;
  created_at: Date | string;
}

function mapFeedback(row: FeedbackRow): FeedbackEntry {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    kind: row.kind as FeedbackKind,
    message: row.message,
    createdAt: toIso(row.created_at),
  };
}

export async function createFeedback(
  pool: Pool,
  input: { orgId: string; userId: string; kind: FeedbackKind; message: string }
): Promise<FeedbackEntry> {
  const { rows } = await pool.query<FeedbackRow>(
    `insert into feedback (org_id, user_id, kind, message)
     values ($1, $2, $3, $4)
     returning id, org_id, user_id, kind, message, created_at`,
    [input.orgId, input.userId, input.kind, input.message]
  );
  return mapFeedback(rows[0]);
}
