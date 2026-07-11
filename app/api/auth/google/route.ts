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

  try {
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
  } catch (err) {
    // Never leave the OAuth entrypoint able to throw an unhandled 500 (e.g. a cookie
    // store failure in an edge runtime): fail closed back to /login with a generic error.
    console.error("[/api/auth/google] failed to start OAuth flow:", err);
    loginUrl.searchParams.set("error", "google_start_failed");
    return NextResponse.redirect(loginUrl);
  }
}
