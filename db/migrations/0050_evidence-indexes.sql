-- Indexes matching the NEW query patterns introduced in rounds 5-8 (live
-- ingestion + evidence-report analytics). No new columns or tables — this
-- migration only adds indexes to access paths that are currently unindexed or
-- would benefit from a covering composite. Idempotent: every statement uses
-- CREATE INDEX IF NOT EXISTS, so it is safe to run repeatedly.
--
-- Column/table names are verified against the base schema (db/migrations.sql:
-- `sources`) and migration 0049 (`evidence_reports`); no columns are invented.

-- === sources (db/migrations.sql) =========================================
--
-- The (source_type, external_id) cache key used by lib/ingest/searchAndCache.ts
-- (lookupCached / upsertRow's `on conflict`) is ALREADY served by the
-- `unique (source_type, external_id)` constraint on the table, so no additional
-- index is needed for that path.
--
-- lib/queries/sources.ts `listSources` scans the whole table ordered by
-- `fetched_at DESC` (the source-library list endpoint). Without an index this is
-- a full sort on every page. This index makes the newest-first ordering (and any
-- recency-bounded scan) an index scan.
create index if not exists sources_fetched_at_idx
  on sources (fetched_at desc);

-- === evidence_reports (0049) =============================================
--
-- The (org_id, created_at desc) index from 0049 already serves the list endpoint
-- (repository.listReports) and the per-month analytics rollup
-- (group by date_trunc('month', created_at) filtered by org_id), because
-- created_at is the trailing sort/group key under org_id. No duplicate needed.
--
-- lib/evidenceReports/analytics.ts additionally runs two org-scoped GROUP BY
-- aggregates that the created_at index does NOT cover:
--
--   * `group by certainty  where org_id = $1` (byCertainty buckets)
--   * `group by verdict    where org_id = $1` (byVerdict distribution)
--
-- Both `certainty` and `verdict` are real, denormalized text columns on
-- evidence_reports (0049). A composite on (org_id, <key>) lets each aggregate be
-- served by an index-only grouped scan within the tenant, instead of scanning
-- every one of the org's reports and hashing.
create index if not exists evidence_reports_org_certainty_idx
  on evidence_reports (org_id, certainty);

create index if not exists evidence_reports_org_verdict_idx
  on evidence_reports (org_id, verdict);
