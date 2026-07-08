-- Admin console module: API keys management + audit viewing + usage metrics.
-- No new tables — reuses the foundation's audit_log and api_keys tables.
-- This migration only ADDITIVELY extends api_keys with columns needed for a
-- production-grade key UX (masked prefix, creator attribution, soft revoke).
-- Idempotent: every statement is guarded with "if not exists".

-- A short, non-secret prefix (e.g. "pt_live_a1b2c3") shown in the UI so users
-- can recognize a key without ever re-exposing the full secret.
alter table api_keys add column if not exists key_prefix text;

-- Who minted the key (nullable so foundation-created rows stay valid).
alter table api_keys add column if not exists created_by uuid references users(id) on delete set null;

-- Soft revoke: keeping the row preserves audit history & last_used_at instead of
-- hard-deleting. A key is active when revoked_at is null.
alter table api_keys add column if not exists revoked_at timestamptz;

-- Fast lookups of a key by its hash during authentication, scoped by org.
create index if not exists api_keys_org_idx on api_keys(org_id, created_at desc);
create index if not exists api_keys_key_hash_idx on api_keys(key_hash);

-- Audit log is queried by org + time, and filtered by action/entity_type/user.
create index if not exists audit_log_org_created_idx on audit_log(org_id, created_at desc);
create index if not exists audit_log_action_idx on audit_log(org_id, action);
create index if not exists audit_log_entity_idx on audit_log(org_id, entity_type);
create index if not exists audit_log_user_idx on audit_log(org_id, user_id);
