-- Lab Notebook Companion. A bench scientist pastes rough notes or a voice-memo
-- transcript; Claude structures them into a reproducible, searchable experiment
-- record (protocol steps, reagents, samples, equipment, observations, outcomes,
-- entities) where every quoted field is grounded to a verbatim span of the raw
-- note. This table is the org-scoped store of those saved records.
--
-- Trust/grounding constraint (enforced in lib/labNotebook/structure.ts, mirrored
-- here as documentation): the `structured` JSON only ever contains source_span
-- values that are verbatim substrings of `raw_notes` — ungroundable items are
-- dropped before a record is ever saved, so this table never holds an unsourced
-- claim about the note.
--
-- Full-text search: a stored generated tsvector over title + raw_notes, so the
-- saved-experiment list can be searched with websearch_to_tsquery without a
-- runtime to_tsvector on every row.
--
-- Idempotent — safe to run repeatedly. org_id on the table; uuid pk; created_at.

create table if not exists lab_experiments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  created_by uuid,
  title text not null,
  experiment_date date,
  raw_notes text not null,
  structured jsonb not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  search tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(raw_notes, ''))
  ) stored
);

create index if not exists lab_experiments_search_idx
  on lab_experiments using gin (search);

create index if not exists lab_experiments_org_created_idx
  on lab_experiments (org_id, created_at desc);
