// Shared account-center domain types. These are the camelCase, JSON-safe shapes
// returned by /api/account/* and consumed by the app/account pages. They are kept
// separate from the Zod input schemas (schemas.ts): schemas validate untrusted
// input at the boundary; these describe trusted, already-shaped output.

// The current user's personal profile within the active org. A user is global,
// but display name / title / avatar live per-org (user_profiles, migration 0019).
export interface AccountProfile {
  userId: string;
  orgId: string;
  email: string;
  name: string | null;
  displayName: string | null;
  title: string | null;
  avatarUrl: string | null;
}

// Typed UI preferences projected out of user_profiles.prefs jsonb.
export type Theme = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";
export type LandingView = "dashboard" | "claims" | "reports";

export interface AccountPreferences {
  theme: Theme;
  density: Density;
  landingView: LandingView;
  emailDigest: boolean;
  reducedMotion: boolean;
}

// A personal access token as returned to the client. The plaintext `token` is
// only ever populated on creation (shown once); list/read never include it.
export interface PersonalToken {
  id: string;
  orgId: string;
  userId: string;
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
  // Present only in the create response — the one-time plaintext secret.
  token?: string;
}

// An active login session (device / browser) for the "where you're signed in" list.
export interface UserSession {
  id: string;
  orgId: string;
  userId: string;
  userAgent: string | null;
  ip: string | null;
  lastSeenAt: string;
  createdAt: string;
  // True when this row is the session the current request is authenticated with.
  current: boolean;
}

// Summary of the user's MFA posture, derived from mfa_factors (migration 0030).
export interface MfaSummary {
  enabled: boolean;
  factorCount: number;
  types: string[];
}
