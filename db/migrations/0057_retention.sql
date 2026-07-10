-- Data-governance RETENTION POLICY. A regulated pharma buyer (medical-affairs /
-- regulatory) must be able to declare, per organization, how long each class of
-- evidence artifact is kept before it is purged — and to enforce that purge on
-- demand. This table stores ONE policy row per org: a nullable retention window
-- (in days) for each governed data class. A null window means "keep forever"
-- (no automatic deletion for that class), so an org that has not configured a
-- policy never has data silently removed.
--
--   * evidence_reports_days — max age (days) for rows in evidence_reports
--   * engine_usage_days      — max age (days) for metered rows in engine_usage
--   * audit_days             — max age (days) for the org's audit_log (advisory;
--                              audit is append-only and purged only on request)
--
-- Idempotent: safe to run repeatedly. org_id is the primary key (one policy per
-- org) and a FK to orgs so a policy is deleted with its org. updated_at tracks
-- the last policy change.

create table if not exists org_retention_policies (
  org_id uuid primary key references orgs(id) on delete cascade,
  evidence_reports_days int,
  engine_usage_days int,
  audit_days int,
  updated_at timestamptz not null default now()
);
