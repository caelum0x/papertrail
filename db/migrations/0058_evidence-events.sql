-- Evidence-event log. PaperTrail emits org webhooks on evidence-lifecycle events
-- (evidence.verified, dossier.built, dossier.published, signal.detected). The
-- existing webhook subsystem (webhooks + webhook_deliveries, migration 0016)
-- handles the outbound HTTP fan-out and per-attempt delivery record. This table
-- is the *source-side* append-only log: one row per emitted evidence event, so an
-- org can audit exactly which lifecycle events fired (and how many endpoints they
-- fanned out to) independent of whether any given receiver was up.
--
-- Governance constraint (enforced in lib/events/evidenceEvents.ts, mirrored here
-- as documentation): the `data` payload NEVER contains claim text — only ids and
-- verdict/certainty metadata — so this log can be exported to a regulated buyer
-- without leaking PHI-adjacent or claim content.
--
-- Idempotent — safe to run repeatedly. org_id on the table; uuid pk; created_at.
-- entity_id/entity_type are soft references (no FK) so an event row can outlive
-- whatever entity produced it and this migration never depends on tables beyond
-- orgs.

create table if not exists evidence_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  event_type text not null,
  entity_type text not null,
  entity_id text not null,
  data jsonb not null default '{}'::jsonb,
  matched integer not null default 0,
  delivered integer not null default 0,
  failed integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists evidence_events_org_id_idx
  on evidence_events(org_id, created_at desc);

create index if not exists evidence_events_org_type_idx
  on evidence_events(org_id, event_type, created_at desc);
