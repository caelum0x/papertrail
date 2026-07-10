-- Tamper-evident EVIDENCE AUDIT CHAIN. A per-org, hash-chained, append-only log
-- of evidence-bearing actions (dossier built, claim verified, source accessed,
-- approval signed) for 21 CFR Part 11-grade defensibility.
--
-- This is deliberately NOT the general audit_log table (0001_foundation.sql).
-- The general log is a flat, best-effort review trail; this is a VERIFIABLE
-- chain. Each row carries prev_hash + hash where
--   hash = sha256(prev_hash + canonical(entry))
-- so any retroactive edit, deletion, or reordering of a row breaks every hash
-- downstream of it and is detectable by recomputation.
--
--   * seq        — dense, per-org monotonic sequence (1, 2, 3, ...). unique per
--                  org so the chain has a single, gap-checkable order.
--   * action     — evidence action verb (e.g. 'dossier.built', 'claim.verified')
--   * entity_*   — what the action was about; entity_id is text (soft ref)
--   * actor      — the acting user (nullable: system/automated actions)
--   * payload    — the canonicalized, hashed content of the entry
--   * prev_hash  — hash of the previous link ('' genesis for seq 1)
--   * hash       — this link's hash; the chain's tamper-evidence anchor
--
-- Idempotent: safe to run repeatedly. org_id on the table; uuid pk; created_at.
-- actor is a soft reference (nullable, no FK) so a chain link outlives the user
-- that produced it — a signed approval record must never vanish because an
-- account was deleted.

create table if not exists evidence_audit_chain (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  seq bigint not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  actor uuid,
  payload jsonb not null default '{}'::jsonb,
  prev_hash text not null,
  hash text not null,
  created_at timestamptz not null default now(),
  unique (org_id, seq)
);

-- Primary read path: an org's chain in order, newest first for listing and
-- oldest first for verification (both served by this composite index).
create index if not exists evidence_audit_chain_org_seq_idx
  on evidence_audit_chain(org_id, seq desc);

-- Lookups by the entity an action concerned (e.g. all events for a dossier).
create index if not exists evidence_audit_chain_org_entity_idx
  on evidence_audit_chain(org_id, entity_type, entity_id);
