-- SSO, SCIM & MFA: enterprise identity for an org. Three org-scoped tables:
--
--   sso_connections   — a configured SSO provider (SAML or OIDC) for the org,
--                        with a claimed email domain that must be verified before
--                        the connection can be enabled. `config` is provider-
--                        specific jsonb (entity id, ACS/issuer, certs, client id,
--                        etc.); secrets in it are masked before leaving the server.
--   scim_directories  — a SCIM 2.0 provisioning endpoint. We store only a
--                        SHA-256 hash of the bearer token the IdP presents (the
--                        raw token is shown to the admin exactly once), plus the
--                        last successful sync time.
--   mfa_factors       — a per-user second factor (TOTP or recovery codes). The
--                        shared secret is stored server-side; a factor is only
--                        usable once `verified` is true.
--
-- Every table has org_id uuid not null (always in the WHERE clause so one org can
-- never read or mutate another's identity config), uuid pks, and created_at.
-- Idempotent: every statement is guarded.

create table if not exists sso_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  protocol text not null,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  domain text,
  verified boolean not null default false,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

-- Hot path: list an org's SSO connections newest-first.
create index if not exists sso_connections_org_created_idx
  on sso_connections(org_id, created_at desc);

-- Look up a connection by its claimed domain within an org (domain routing).
create index if not exists sso_connections_org_domain_idx
  on sso_connections(org_id, domain);

create table if not exists scim_directories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null default 'SCIM directory',
  bearer_token_hash text not null,
  last_sync_at timestamptz,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

-- Hot path: list an org's SCIM directories newest-first.
create index if not exists scim_directories_org_created_idx
  on scim_directories(org_id, created_at desc);

create table if not exists mfa_factors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  secret text not null,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

-- Hot path: a user's factors within an org (drives the security page + login).
create index if not exists mfa_factors_org_user_idx
  on mfa_factors(org_id, user_id, created_at desc);
