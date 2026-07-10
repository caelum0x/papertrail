// Google OAuth 2.0 (OpenID Connect) helpers. Pure config + fetch wrappers around
// Google's authorization, token, and userinfo endpoints — no app state, no DB.
//
// Configuration is via env (documented in .env.example):
//   GOOGLE_CLIENT_ID      — OAuth 2.0 client id from Google Cloud Console
//   GOOGLE_CLIENT_SECRET  — the matching client secret
// The redirect URI is derived from the request origin at call time so the same
// build works on localhost and on the deployed URL — you must add BOTH
//   http://localhost:3000/api/auth/google/callback
//   https://<your-domain>/api/auth/google/callback
// as Authorized redirect URIs in the Google console.

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

/** True only when both client id and secret are present — the UI hides/disables Google otherwise. */
export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function requireConfig(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
  }
  return { clientId, clientSecret };
}

/** Build the Google consent-screen URL the browser is redirected to. */
export function buildGoogleAuthUrl(redirectUri: string, state: string): string {
  const { clientId } = requireConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** Exchange an authorization code for tokens. Throws on a non-2xx from Google. */
export async function exchangeGoogleCode(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string }> {
  const { clientId, clientSecret } = requireConfig();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status}).`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Google token response contained no access_token.");
  }
  return { accessToken: data.access_token };
}

/** Fetch the signed-in user's OIDC profile with an access token. */
export async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch(USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Google userinfo request failed (${res.status}).`);
  }
  const data = (await res.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };
  if (!data.sub || !data.email) {
    throw new Error("Google profile missing sub/email.");
  }
  return {
    sub: data.sub,
    email: data.email.toLowerCase(),
    emailVerified: data.email_verified !== false,
    name: data.name ?? null,
  };
}
