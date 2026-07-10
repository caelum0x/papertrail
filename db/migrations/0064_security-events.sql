-- Tenant-scoped threat-detection ("XDR") events. The security scan (see
-- lib/security/securityScan.ts + app/api/cron/security-scan/route.ts) runs
-- deterministic detectors over telemetry the platform already owns
-- (api_requests, rate_limit_events, error_events) and persists a
-- security_events row for each new finding. High-severity findings are also
-- appended to the org's WORM audit chain for tamper-evident retention.
--
-- Multi-tenant: org_id on every row, cascading from orgs so a tenant can never
-- read or mutate another tenant's findings. `detail` is a free-form jsonb blob
-- carrying ONLY ids/counts/thresholds — never raw claim/patient text, secrets,
-- or PHI. `source_ip` is nullable because the current telemetry does not always
-- carry a client IP; when present it is a coarse network identifier, never a
-- user identity. Idempotent — safe to run repeatedly.

create table if not exists security_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  kind text not null,
  severity text not null default 'low'
    check (severity in ('low', 'medium', 'high', 'critical')),
  detail jsonb not null default '{}'::jsonb,
  source_ip text,
  detected_at timestamptz not null default now()
);

-- Primary access path: an org's findings, newest first (the event feed).
create index if not exists security_events_org_detected_idx
  on security_events(org_id, detected_at desc);

-- Severity filtering / rollups on the feed.
create index if not exists security_events_severity_idx
  on security_events(severity);

-- Dedup support: the scan looks up recent findings of the same (org, kind) to
-- avoid re-emitting the same standing condition on every sweep.
create index if not exists security_events_org_kind_detected_idx
  on security_events(org_id, kind, detected_at desc);
