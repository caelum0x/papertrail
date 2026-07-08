import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "pt_session";

// Two concerns, one middleware:
//  1. /console/* is protected — redirect to /login when there's no session cookie.
//  2. Every response gets baseline security headers. Rate limiting itself lives
//     in the /api/verify route handler (needs per-route config, not global).
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/console" || pathname.startsWith("/console/")) {
    const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
    if (!hasSession) {
      const loginUrl = new URL("/login", req.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  const res = NextResponse.next();
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return res;
}

export const config = {
  matcher: ["/api/:path*", "/console/:path*"],
};
