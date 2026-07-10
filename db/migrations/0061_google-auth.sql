-- Google OAuth sign-in. Users can now authenticate with Google in addition to
-- email + password. A Google-only user has no password, so password_hash becomes
-- nullable; auth_provider records how the account signs in; google_sub is the
-- stable Google subject id used to recognise a returning Google user.
--
-- Idempotent — safe to run repeatedly.

alter table users alter column password_hash drop not null;
alter table users add column if not exists auth_provider text not null default 'password';
alter table users add column if not exists google_sub text;

-- One account per Google subject. Partial unique index so password users (null
-- google_sub) are unaffected.
create unique index if not exists users_google_sub_idx
  on users(google_sub) where google_sub is not null;
