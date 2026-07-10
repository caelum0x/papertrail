import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

// Session JWT lives in an httpOnly cookie. HS256 signed with AUTH_SECRET.
// A dev fallback secret keeps local dev working without config, but production
// MUST set AUTH_SECRET (see .env.example).
const COOKIE_NAME = "pt_session";
const DEV_FALLBACK_SECRET = "papertrail-dev-secret-do-not-use-in-prod";
const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET ?? DEV_FALLBACK_SECRET;
  return new TextEncoder().encode(secret);
}

export async function createSession(userId: string): Promise<void> {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SEVEN_DAYS_SECONDS,
  });
}

export async function getSessionUserId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
