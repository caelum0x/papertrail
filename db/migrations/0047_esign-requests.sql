-- E-signature request workflow. Distinct from the append-only audit hash-chain
-- in the compliance module (0028): this models an explicit, ordered signing
-- ceremony over an arbitrary entity (a claim, a report, a verification, etc.).
--
--   * signature_requests: the ceremony itself — a titled request to sign some
--     entity, moving draft -> pending -> completed (or cancelled).
--   * signature_request_signers: the ordered list of signers. order_index drives
--     turn-taking; only the current pending signer (lowest order_index still
--     'pending') may sign. Each signer row tracks its own status/signed_at.
--   * signature_certificates: issued exactly once when every signer has signed.
--     cert_hash is a tamper-evident digest of the completed request + signer
--     trail, mirroring the compliance hash-chain's evidence pattern.
--
-- Idempotent: safe to run repeatedly. org_id on every table; uuid pks; created_at.

create table if not exists signature_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  title text not null,
  status text not null default 'draft',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists signature_requests_org_id_idx
  on signature_requests(org_id, created_at desc);

create index if not exists signature_requests_org_status_idx
  on signature_requests(org_id, status, created_at desc);

create index if not exists signature_requests_org_entity_idx
  on signature_requests(org_id, entity_type, entity_id);

create table if not exists signature_request_signers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  request_id uuid not null references signature_requests(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  order_index integer not null default 0,
  status text not null default 'pending',
  signed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists signature_request_signers_request_idx
  on signature_request_signers(org_id, request_id, order_index asc);

-- A user appears at most once per request, so turn-taking is unambiguous.
create unique index if not exists signature_request_signers_uniq
  on signature_request_signers(org_id, request_id, user_id);

create table if not exists signature_certificates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  request_id uuid not null references signature_requests(id) on delete cascade,
  cert_hash text not null,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists signature_certificates_org_id_idx
  on signature_certificates(org_id, created_at desc);

-- Exactly one certificate per request (issued once, on completion).
create unique index if not exists signature_certificates_request_uniq
  on signature_certificates(org_id, request_id);
