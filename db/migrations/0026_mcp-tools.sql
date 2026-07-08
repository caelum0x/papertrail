-- MCP & tool registry: expose PaperTrail's verification capabilities as callable
-- tools (an MCP-style toolset) and record every invocation. Built-in tools live in
-- code (lib/tools/registry.ts); `tool_registrations` holds org-authored/custom tool
-- entries and per-org enable/disable overrides. Both tables are org-scoped
-- (org_id not null) and always queried with ctx.org.id so one org can never read
-- or execute against another org's registrations or call history. Idempotent.
--
-- `tool_registrations.input_schema` stores a JSON-Schema-ish description of the
-- tool's expected input (rendered in the console + surfaced in the MCP manifest).
-- `tool_calls` is an append-only invocation log: the (redacted) input, the output,
-- a status, and how long the executor took — so operators can audit tool usage.

create table if not exists tool_registrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  description text not null default '',
  input_schema jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- Hot path: list an org's registered tools newest-first.
create index if not exists tool_registrations_org_created_idx
  on tool_registrations(org_id, created_at desc);

-- One registration per (org, tool name): registering the same name upserts.
create unique index if not exists tool_registrations_org_name_uidx
  on tool_registrations(org_id, name);

create table if not exists tool_calls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  tool_name text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  status text not null default 'success',
  duration_ms integer not null default 0,
  created_at timestamptz not null default now()
);

-- Hot path: newest-first call history for an org.
create index if not exists tool_calls_org_created_idx
  on tool_calls(org_id, created_at desc);

-- Filter an org's history by a specific tool.
create index if not exists tool_calls_org_tool_idx
  on tool_calls(org_id, tool_name);
