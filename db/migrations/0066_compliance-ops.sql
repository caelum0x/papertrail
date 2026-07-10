-- Compliance-OPS run ledger. Phase 3 enterprise hardening operationalizes the
-- compliance controls whose data models already exist (retention_policies,
-- audit_chain, permission_grants). Those controls are now EXERCISED by scheduled
-- jobs and admin reviews; this table records the OUTCOME of each exercise so the
-- console can surface "last purge run", "chain-integrity status", and the last
-- access review without re-running anything.
--
-- A run row is an operational fact, not sensitive evidence: it stores COUNTS and
-- a coarse status only. It must NEVER hold claim text, patient text, secrets, or
-- any per-row payload — only aggregate integers and a short status/reason. The
-- `detail` jsonb is constrained by convention to counts/ids (enforced in the
-- lib layer that writes it), keeping PHI out of the operational ledger.
--
-- Every row is org-scoped (multi-tenant) with a uuid pk and created_at.
-- Idempotent — safe to run repeatedly.

create table if not exists compliance_control_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  -- Which control produced this run.
  control text not null
    check (control in ('retention_purge', 'chain_integrity', 'access_review')),
  -- Coarse outcome. 'ok' = control ran clean; 'failed' = the control detected a
  -- problem (e.g. a broken chain) or errored; 'partial' = best-effort run where
  -- some units succeeded and some were skipped/errored.
  status text not null check (status in ('ok', 'failed', 'partial')),
  -- Short, non-sensitive reason for a non-ok status (e.g. "broken chain at
  -- seq 42"). Never contains claim/patient text.
  reason text,
  -- Aggregate, non-sensitive detail: counts and ids only. Defaults to an empty
  -- object. The writing lib layer is responsible for keeping this counts-only.
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Fast "latest run per (org, control)" lookups for the console.
create index if not exists compliance_control_runs_org_control_idx
  on compliance_control_runs(org_id, control, created_at desc);

create index if not exists compliance_control_runs_org_id_idx
  on compliance_control_runs(org_id, created_at desc);
