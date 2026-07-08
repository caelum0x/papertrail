-- Help center, support tickets, and product feedback.
--
-- help_articles      — per-org knowledge base articles, addressed by a unique
--                      (org, slug). Grouped by `category` for the console's
--                      CategoryList. org_id is NOT NULL: articles are treated as
--                      an org-scoped KB (seed per-org rather than a global set).
-- support_tickets    — a support request opened by a user. Has status + priority
--                      workflow fields the ReplyBox/TicketHeader mutate.
-- ticket_messages    — threaded replies on a ticket (the MessageThread). Every
--                      message carries author_id so the UI can attribute it.
-- feedback           — lightweight product feedback (kind = bug|idea|praise|other),
--                      not part of the ticket workflow.
--
-- Every table is org-scoped (org_id not null, references orgs) with uuid pks and
-- created_at. Idempotent: safe to run repeatedly.

create table if not exists help_articles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  slug text not null,
  title text not null,
  body text not null,
  category text not null default 'general',
  created_at timestamptz not null default now()
);

-- Primary list access path: an org's articles, optionally filtered by category.
create index if not exists help_articles_org_category_idx
  on help_articles(org_id, category, created_at desc);

-- Slugs are unique within an org so /help/articles/[slug] resolves one article.
create unique index if not exists help_articles_org_slug_uniq
  on help_articles(org_id, lower(slug));

create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  subject text not null,
  body text not null,
  status text not null default 'open',
  priority text not null default 'normal',
  created_at timestamptz not null default now()
);

-- List an org's tickets newest-first; the status filter is the common facet.
create index if not exists support_tickets_org_status_idx
  on support_tickets(org_id, status, created_at desc);

create index if not exists support_tickets_org_created_idx
  on support_tickets(org_id, created_at desc);

create index if not exists support_tickets_user_idx
  on support_tickets(user_id);

create table if not exists ticket_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  author_id uuid not null references users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

-- The thread view loads one ticket's messages oldest-first.
create index if not exists ticket_messages_ticket_idx
  on ticket_messages(ticket_id, created_at asc);

create index if not exists ticket_messages_org_idx
  on ticket_messages(org_id, created_at desc);

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null default 'other',
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists feedback_org_created_idx
  on feedback(org_id, created_at desc);
