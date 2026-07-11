-- Living evidence monitoring. A monitor watches a topic/claim; when NEW evidence
-- lands, PaperTrail deterministically re-pools the accumulating studies (cumulative
-- meta-analysis) and flags whether the pooled verdict would FLIP (direction or
-- significance). No LLM decides the verdict — the flip is decided by the same
-- inverse-variance closed forms as lib/metaAnalysis.ts.
--
-- Governance constraint (enforced in lib/livingEvidence/monitor.ts, mirrored here
-- as documentation): stored jsonb (baseline, event detail) carries only numeric
-- estimates / ids / counts — never claim or source raw text — so a monitor's
-- history can be exported to a regulated buyer without leaking claim content.
--
-- Idempotent — safe to run repeatedly. org_id on the monitor table; uuid pk;
-- created_at. Events cascade with their monitor.

create table if not exists living_evidence_monitors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  topic text not null,
  query text,
  baseline jsonb,
  last_checked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists living_evidence_events (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references living_evidence_monitors(id) on delete cascade,
  kind text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists living_evidence_monitors_org_created_idx
  on living_evidence_monitors(org_id, created_at desc);

create index if not exists living_evidence_events_monitor_idx
  on living_evidence_events(monitor_id, created_at desc);
