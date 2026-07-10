-- Per-engine usage metering. Every evidence/bio engine call and its Claude-token
-- cost is recorded here per org, so billing and quota enforcement can roll up
-- consumption by engine and by token spend. Append-only: one row per metered
-- call. org_id on the table; uuid pk; occurred_at timestamptz default now().
--
--   * engine        — the metered engine key (e.g. 'meta_analysis', 'faers')
--   * units         — how many billable units the call consumed (default 1)
--   * claude_tokens — Claude tokens attributed to the call (default 0)
--
-- Idempotent: safe to run repeatedly. Indexed for the two hot read paths — a
-- recent-activity scan (org_id, occurred_at desc) and a per-engine roll-up
-- (org_id, engine).

create table if not exists engine_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  engine text not null,
  units int not null default 1,
  claude_tokens int not null default 0,
  occurred_at timestamptz not null default now()
);

create index if not exists engine_usage_org_occurred_idx
  on engine_usage(org_id, occurred_at desc);

create index if not exists engine_usage_org_engine_idx
  on engine_usage(org_id, engine);
