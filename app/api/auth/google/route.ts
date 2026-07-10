import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isGoogleConfigured, buildGoogleAuthUrl } from "@/lib/auth/google";

export const runtime = "nodejs";

// GET /api/auth/google — start the Google OAuth flow. Generates a CSRF state,
// stashes it in a short-lived httpOnly cookie, and redirects to Google's consent
// screen. The callback verifies the state before trusting the code.
const STATE_COOKIE = "pt_oauth_state";

export async function GET(req: NextRequest): Promise<Response> {
  const origin = req.nextUrl.origin;
  const loginUrl = new URL("/login", origin);

  if (!isGoogleConfigured()) {
    loginUrl.searchParams.set("error", "google_not_configured");
    return NextResponse.redirect(loginUrl);
  }

  const state = crypto.randomUUID();
  const redirectUri = `${origin}/api/auth/google/callback`;
  const authUrl = buildGoogleAuthUrl(redirectUri, state);

  const store = await cookies();
  store.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes to complete the round-trip
  });

  return NextResponse.redirect(authUrl);
}
