import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import type {
  AccountProfile,
  AccountPreferences,
  Density,
  LandingView,
  MfaSummary,
  PersonalToken,
  Theme,
  UserSession,
} from "./types";

// Data-access layer for the account center. Every query is scoped by BOTH org_id
// and user_id: an account surface is personal, so a user only ever sees their own
// rows within the active org. Callers pass ctx.org.id / ctx.user.id explicitly so
// this module stays decoupled from the request handler.

const DEFAULT_PREFERENCES: AccountPreferences = {
  theme: "system",
  density: "comfortable",
  landingView: "dashboard",
  emailDigest: true,
  reducedMotion: false,
};

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

// Loads the profile row (lazily defaulting when none exists yet). Merges the
// global user record (email/name) with the per-org display fields.
export async function getProfile(
  orgId: string,
  user: { id: string; email: string; name: string | null }
): Promise<AccountProfile> {
  const { rows } = await getPool().query(
    `select display_name, title, avatar_url
       from user_profiles
      where org_id = $1 and user_id = $2
      limit 1`,
    [orgId, user.id]
  );
  const row = rows[0];
  return {
    userId: user.id,
    orgId,
    email: user.email,
    name: user.name ?? null,
    displayName: row?.display_name ?? null,
    title: row?.title ?? null,
    avatarUrl: row?.avatar_url ?? null,
  };
}

export interface ProfileUpdate {
  name?: string | null;
  displayName?: string | null;
  title?: string | null;
  avatarUrl?: string | null;
}

// Applies a partial profile update. The user's global name lives on `users`;
// display/title/avatar live on `user_profiles` (upserted). Omitted fields keep
// their current value. Returns the refreshed, merged profile.
export async function updateProfile(
  orgId: string,
  user: { id: string; email: string; name: string | null },
  update: ProfileUpdate
): Promise<AccountProfile> {
  const pool = getPool();
  const current = await getProfile(orgId, user);

  if (update.name !== undefined) {
    await pool.query(
      `update users set name = $1, updated_at = now() where id = $2`,
      [update.name, user.id]
    );
  }

  const displayName =
    update.displayName === undefined ? current.displayName : update.displayName;
  const title = update.title === undefined ? current.title : update.title;
  const avatarUrl =
    update.avatarUrl === undefined ? current.avatarUrl : update.avatarUrl;

  await pool.query(
    `insert into user_profiles (org_id, user_id, display_name, title, avatar_url)
       values ($1, $2, $3, $4, $5)
     on conflict (org_id, user_id) do update set
       display_name = excluded.display_name,
       title = excluded.title,
       avatar_url = excluded.avatar_url`,
    [orgId, user.id, displayName, title, avatarUrl]
  );

  const nextName = update.name === undefined ? user.name : update.name;
  return getProfile(orgId, { ...user, name: nextName ?? null });
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

// Returns the stored bcrypt hash for a user (used to verify the current password
// before allowing a change). Global row — not org-scoped — but only ever called
// for ctx.user.id.
export async function getPasswordHash(userId: string): Promise<string | null> {
  const { rows } = await getPool().query(
    `select password_hash from users where id = $1 limit 1`,
    [userId]
  );
  return rows[0]?.password_hash ?? null;
}

export async function setPasswordHash(
  userId: string,
  hash: string
): Promise<void> {
  await getPool().query(
    `update users set password_hash = $1, updated_at = now() where id = $2`,
    [hash, userId]
  );
}

// ---------------------------------------------------------------------------
// Personal tokens
// ---------------------------------------------------------------------------

function mapToken(row: Record<string, unknown>): PersonalToken {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    userId: row.user_id as string,
    name: row.name as string,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string).toISOString() : null,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

export async function listTokens(
  orgId: string,
  userId: string,
  limit: number,
  offset: number
): Promise<{ items: PersonalToken[]; total: number }> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select id, org_id, user_id, name, last_used_at, created_at
       from personal_tokens
      where org_id = $1 and user_id = $2
      order by created_at desc
      limit $3 offset $4`,
    [orgId, userId, limit, offset]
  );
  const { rows: countRows } = await pool.query(
    `select count(*)::int as total from personal_tokens
      where org_id = $1 and user_id = $2`,
    [orgId, userId]
  );
  return { items: rows.map(mapToken), total: countRows[0]?.total ?? 0 };
}

export async function createToken(
  orgId: string,
  userId: string,
  name: string,
  tokenHash: string
): Promise<PersonalToken> {
  const { rows } = await getPool().query(
    `insert into personal_tokens (org_id, user_id, name, token_hash)
       values ($1, $2, $3, $4)
     returning id, org_id, user_id, name, last_used_at, created_at`,
    [orgId, userId, name, tokenHash]
  );
  return mapToken(rows[0]);
}

// Deletes a token, scoped to (org, user) so a user can only revoke their own.
// Returns true when a row was actually deleted (for a 404 vs 200 decision).
export async function deleteToken(
  orgId: string,
  userId: string,
  id: string
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `delete from personal_tokens where id = $1 and org_id = $2 and user_id = $3`,
    [id, orgId, userId]
  );
  return (rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function mapSession(
  row: Record<string, unknown>,
  currentSessionId: string | null
): UserSession {
  const id = row.id as string;
  return {
    id,
    orgId: row.org_id as string,
    userId: row.user_id as string,
    userAgent: (row.user_agent as string | null) ?? null,
    ip: (row.ip as string | null) ?? null,
    lastSeenAt: new Date(row.last_seen_at as string).toISOString(),
    createdAt: new Date(row.created_at as string).toISOString(),
    current: currentSessionId != null && id === currentSessionId,
  };
}

export async function listSessions(
  orgId: string,
  userId: string,
  currentSessionId: string | null,
  limit: number,
  offset: number
): Promise<{ items: UserSession[]; total: number }> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select id, org_id, user_id, user_agent, ip, last_seen_at, created_at
       from user_sessions
      where org_id = $1 and user_id = $2
      order by last_seen_at desc
      limit $3 offset $4`,
    [orgId, userId, limit, offset]
  );
  const { rows: countRows } = await pool.query(
    `select count(*)::int as total from user_sessions
      where org_id = $1 and user_id = $2`,
    [orgId, userId]
  );
  return {
    items: rows.map((r) => mapSession(r, currentSessionId)),
    total: countRows[0]?.total ?? 0,
  };
}

// Records / refreshes a session row for this device, keyed on (org, user,
// user_agent, ip) so repeat visits from the same device update last_seen_at
// rather than piling up duplicates. Returns the session id so callers can mark
// the "current" one in the list. Best-effort de-duplication only.
export async function touchSession(
  orgId: string,
  userId: string,
  userAgent: string | null,
  ip: string | null
): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select id from user_sessions
      where org_id = $1 and user_id = $2
        and coalesce(user_agent, '') = coalesce($3, '')
        and coalesce(ip, '') = coalesce($4, '')
      order by last_seen_at desc
      limit 1`,
    [orgId, userId, userAgent, ip]
  );
  if (rows[0]?.id) {
    const id = rows[0].id as string;
    await pool.query(
      `update user_sessions set last_seen_at = now() where id = $1`,
      [id]
    );
    return id;
  }
  const { rows: inserted } = await pool.query(
    `insert into user_sessions (org_id, user_id, user_agent, ip)
       values ($1, $2, $3, $4)
     returning id`,
    [orgId, userId, userAgent, ip]
  );
  return inserted[0].id as string;
}

export async function deleteSession(
  orgId: string,
  userId: string,
  id: string
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `delete from user_sessions where id = $1 and org_id = $2 and user_id = $3`,
    [id, orgId, userId]
  );
  return (rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// MFA summary
// ---------------------------------------------------------------------------

// Summarizes the user's verified MFA factors in this org (read-only view; the
// account center links out to the dedicated MFA flow for enrollment).
export async function getMfaSummary(
  orgId: string,
  userId: string
): Promise<MfaSummary> {
  const { rows } = await getPool().query(
    `select type from mfa_factors
      where org_id = $1 and user_id = $2 and verified = true`,
    [orgId, userId]
  );
  const types = Array.from(new Set(rows.map((r) => r.type as string)));
  return { enabled: rows.length > 0, factorCount: rows.length, types };
}

// ---------------------------------------------------------------------------
// Preferences (projected out of user_profiles.prefs jsonb)
// ---------------------------------------------------------------------------

async function loadRawPrefs(
  orgId: string,
  userId: string
): Promise<Record<string, unknown>> {
  const { rows } = await getPool().query(
    `select prefs from user_profiles where org_id = $1 and user_id = $2 limit 1`,
    [orgId, userId]
  );
  return (rows[0]?.prefs as Record<string, unknown>) ?? {};
}

// Projects the untrusted jsonb blob onto the typed Preferences view, falling back
// to defaults for any key that is absent or malformed. Never trusts stored shape.
export function projectPreferences(
  raw: Record<string, unknown>
): AccountPreferences {
  const themeOk = (v: unknown): v is Theme =>
    v === "system" || v === "light" || v === "dark";
  const densityOk = (v: unknown): v is Density =>
    v === "comfortable" || v === "compact";
  const landingOk = (v: unknown): v is LandingView =>
    v === "dashboard" || v === "claims" || v === "reports";

  return {
    theme: themeOk(raw.theme) ? raw.theme : DEFAULT_PREFERENCES.theme,
    density: densityOk(raw.density) ? raw.density : DEFAULT_PREFERENCES.density,
    landingView: landingOk(raw.landingView)
      ? raw.landingView
      : DEFAULT_PREFERENCES.landingView,
    emailDigest:
      typeof raw.emailDigest === "boolean"
        ? raw.emailDigest
        : DEFAULT_PREFERENCES.emailDigest,
    reducedMotion:
      typeof raw.reducedMotion === "boolean"
        ? raw.reducedMotion
        : DEFAULT_PREFERENCES.reducedMotion,
  };
}

export async function getPreferences(
  orgId: string,
  userId: string
): Promise<AccountPreferences> {
  return projectPreferences(await loadRawPrefs(orgId, userId));
}

export interface PreferencesUpdate {
  theme?: Theme;
  density?: Density;
  landingView?: LandingView;
  emailDigest?: boolean;
  reducedMotion?: boolean;
}

// Merges the changed preference keys into the existing prefs jsonb, preserving
// any unrelated keys other features may store there.
export async function updatePreferences(
  orgId: string,
  userId: string,
  update: PreferencesUpdate
): Promise<AccountPreferences> {
  const pool = getPool();
  const raw = await loadRawPrefs(orgId, userId);
  const next: Record<string, unknown> = { ...raw };
  if (update.theme !== undefined) next.theme = update.theme;
  if (update.density !== undefined) next.density = update.density;
  if (update.landingView !== undefined) next.landingView = update.landingView;
  if (update.emailDigest !== undefined) next.emailDigest = update.emailDigest;
  if (update.reducedMotion !== undefined) next.reducedMotion = update.reducedMotion;

  await pool.query(
    `insert into user_profiles (org_id, user_id, prefs)
       values ($1, $2, $3)
     on conflict (org_id, user_id) do update set prefs = excluded.prefs`,
    [orgId, userId, JSON.stringify(next)]
  );
  return projectPreferences(next);
}

export type { Pool };
