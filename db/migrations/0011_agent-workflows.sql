-- Agentic workflow engine: composable pipelines + run observability.
-- Three tables:
--   agent_workflows — custom pipeline definitions authored per org (built-in
--                     pipelines live in code; these are org-saved variants).
--   agent_runs      — one execution of a workflow, with input/output + status.
--   agent_steps     — per-step trace rows (input/output/tokens/duration) so the
--                     run viewer can show exactly what each stage did.
-- Idempotent: every statement guards with "if not exists". Every table carries
-- org_id (not null) + created_at + uuid pk, per the foundation conventions.

create extension if not exists "pgcrypto";

-- Custom workflow definitions saved by an org. The `definition` jsonb mirrors the
-- WorkflowDefinition shape used by the built-in registry (key, name, steps[]).
create table if not exists agent_workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  description text,
  definition jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- A single execution of a workflow (built-in key or a saved agent_workflows row).
-- workflow_id is nullable because built-in pipelines are keyed by string, not a
-- table row; the key is preserved in `input.workflowKey` and on the run itself.
create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  workflow_id uuid references agent_workflows(id) on delete set null,
  workflow_key text,
  status text not null default 'running',
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  created_by uuid references users(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

-- Per-step execution trace for a run. step_index preserves ordering; tokens and
-- duration_ms power the observability/trace viewer.
create table if not exists agent_steps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  run_id uuid not null references agent_runs(id) on delete cascade,
  step_index integer not null,
  name text not null,
  status text not null default 'pending',
  input jsonb,
  output jsonb,
  error text,
  tokens integer,
  duration_ms integer,
  created_at timestamptz not null default now()
);

-- Additive guards for pre-existing installs (columns not present in older 0011s).
alter table agent_runs add column if not exists workflow_key text;
alter table agent_runs add column if not exists created_by uuid references users(id) on delete set null;
alter table agent_steps add column if not exists error text;

-- Access patterns: list workflows/runs by org + recency; fetch a run's steps in order.
create index if not exists agent_workflows_org_idx on agent_workflows(org_id, created_at desc);
create index if not exists agent_runs_org_idx on agent_runs(org_id, created_at desc);
create index if not exists agent_runs_workflow_idx on agent_runs(org_id, workflow_id);
create index if not exists agent_steps_run_idx on agent_steps(run_id, step_index asc);
create index if not exists agent_steps_org_idx on agent_steps(org_id, created_at desc);
