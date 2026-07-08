-- Compliance: e-signatures, a WORM (write-once) hash-chained audit ledger,
-- provenance/retention policies. Models 21 CFR Part 11-style controls:
--   * signatures      — an e-signature binds a user + a "meaning" (e.g. approval)
--                       to a specific entity, recording the hash that was signed.
--   * audit_chain     — an append-only, hash-chained ledger. Each entry's
--                       entry_hash = sha256(prev_hash + canonical(event)), so any
--                       tampering with a past event breaks every subsequent hash.
--   * retention_policies — per-entity-type data retention windows (retain_days).
-- Every table is org-scoped (multi-tenant) with uuid pks and created_at.
-- Idempotent — safe to run repeatedly.

-- An e-signature: a signer attesting to a `meaning` (approval, review, authorship,
-- responsibility) over a specific entity. signed_hash captures what was signed so
-- the signature is verifiably bound to a concrete state, and the signing event is
-- also appended to the audit chain (see lib/compliance/esign.ts). signer_id is a
-- plain uuid (references users) — no cascade delete so signatures survive user
-- removal, which is the whole point of an audit record.
create table if not exists signatures (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  signer_id uuid not null references users(id),
  meaning text not null
    check (meaning in ('approval', 'review', 'authorship', 'responsibility')),
  signed_hash text not null,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists signatures_org_id_idx
  on signatures(org_id, created_at desc);
create index if not exists signatures_entity_idx
  on signatures(org_id, entity_type, entity_id);
create index if not exists signatures_signer_idx
  on signatures(org_id, signer_id);

-- Append-only hash-chained audit ledger. `seq` is a per-org monotonic counter
-- (1-based). `prev_hash` is the previous entry's entry_hash (or a fixed genesis
-- string for seq 1). `entry_hash` = sha256(prev_hash + canonical(event)). The
-- unique (org_id, seq) constraint prevents forks/duplicate sequence numbers.
create table if not exists audit_chain (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  seq bigint not null,
  prev_hash text not null,
  entry_hash text not null,
  event jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, seq)
);

create index if not exists audit_chain_org_seq_idx
  on audit_chain(org_id, seq);

-- Data retention policy: how long to retain records of a given entity_type
-- before they may be purged. One active policy per (org, entity_type).
create table if not exists retention_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  entity_type text not null,
  retain_days integer not null check (retain_days >= 0),
  created_at timestamptz not null default now(),
  unique (org_id, entity_type)
);

create index if not exists retention_policies_org_id_idx
  on retention_policies(org_id, created_at desc);
