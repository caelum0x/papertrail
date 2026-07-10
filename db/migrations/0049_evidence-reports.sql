-- Persisted composite EVIDENCE REPORTS. The deterministic evidence engine
-- (lib/evidenceReport.ts) chains meta-analysis -> publication-bias -> GRADE ->
-- synthesis verdict into ONE defensible object. This table makes that object a
-- real multi-tenant artifact: a caller computes a report and stores it here so an
-- org can list, retrieve, and audit its verification history — not a stateless
-- endpoint whose output vanishes after the response.
--
--   * claim      — the efficacy claim the report verifies (denormalized for lists)
--   * verdict    — synthesis verdict, denormalized for filtering/scanning
--   * certainty  — GRADE certainty rating, denormalized for the same reason
--   * pooled     — the pooled meta-analysis summary (nullable: insufficient reports)
--   * report     — the full composite object exactly as the engine produced it
--
-- Idempotent: safe to run repeatedly. org_id on the table; uuid pk; created_at.
-- project_id and created_by are soft references (nullable, no FK) so a report can
-- outlive whatever produced it and this migration never depends on tables beyond
-- orgs.

create table if not exists evidence_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid,
  created_by uuid,
  claim text not null,
  verdict text,
  certainty text,
  pooled jsonb,
  report jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists evidence_reports_org_id_idx
  on evidence_reports(org_id, created_at desc);
