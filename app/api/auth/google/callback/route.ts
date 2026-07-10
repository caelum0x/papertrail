import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import {
  exchangeGoogleCode,
  fetchGoogleProfile,
  isGoogleConfigured,
  type GoogleProfile,
} from "@/lib/auth/google";

export const runtime = "nodejs";

const STATE_COOKIE = "pt_oauth_state";

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = crypto.randomUUID().slice(0, 6);
  return base ? `${base}-${suffix}` : `org-${suffix}`;
}

// Resolve a user for this Google profile: recognise a returning Google user by
// sub, link an existing password account by email, or create a fresh user + a
// personal org + owner membership (mirroring the register flow). Returns the user id.
async function resolveGoogleUser(profile: GoogleProfile): Promise<string> {
  const pool = getPool();

  const bySub = await pool.query(`select id from users where google_sub = $1`, [profile.sub]);
  if (bySub.rows.length > 0) {
    return bySub.rows[0].id as string;
  }

  // Link to an existing password account with the same (verified) email.
  const byEmail = await pool.query(`select id from users where email = $1`, [profile.email]);
  if (byEmail.rows.length > 0) {
    const userId = byEmail.rows[0].id as string;
    await pool.query(
      `update users set google_sub = $1, auth_provider = 'google', updated_at = now() where id = $2`,
      [profile.sub, userId]
    );
    return userId;
  }

  // New account: user + org + owner membership in one transaction.
  const client = await pool.connect();
  try {
    await client.query("begin");
    const userRes = await client.query(
      `insert into users (email, name, auth_provider, google_sub)
       values ($1, $2, 'google', $3) returning id`,
      [profile.email, profile.name, profile.sub]
    );
    const userId = userRes.rows[0].id as string;

    const orgName = profile.name ? `${profile.name}'s workspace` : "My workspace";
    const orgRes = await client.query(
      `insert into orgs (name, slug) values ($1, $2) returning id`,
      [orgName, slugify(orgName)]
    );
    const orgId = orgRes.rows[0].id as string;

    await client.query(
      `insert into memberships (org_id, user_id, role) values ($1, $2, 'owner')`,
      [orgId, userId]
    );
    await client.query("commit");

    await writeAudit(pool, {
      orgId,
      userId,
      action: "org.created",
      entityType: "org",
      entityId: orgId,
      metadata: { via: "google" },
    }).catch(() => undefined);

    return userId;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// GET /api/auth/google/callback — Google redirects here with ?code&state. Verify
// the CSRF state, exchange the code, load the profile, resolve/create the user,
// mint a session, and land in the console. Any failure returns to /login?error=.
export async function GET(req: NextRequest): Promise<Response> {
  const origin = req.nextUrl.origin;
  const loginUrl = new URL("/login", origin);

  const fail = (reason: string): Response => {
    loginUrl.searchParams.set("error", reason);
    return NextResponse.redirect(loginUrl);
  };

  if (!isGoogleConfigured()) return fail("google_not_configured");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state) return fail("oauth_missing_params");

  const store = await cookies();
  const expectedState = store.get(STATE_COOKIE)?.value;
  store.delete(STATE_COOKIE);
  if (!expectedState || expectedState !== state) {
    return fail("oauth_state");
  }

  try {
    const redirectUri = `${origin}/api/auth/google/callback`;
    const { accessToken } = await exchangeGoogleCode(code, redirectUri);
    const profile = await fetchGoogleProfile(accessToken);
    if (!profile.emailVerified) {
      return fail("google_email_unverified");
    }

    const userId = await resolveGoogleUser(profile);
    await createSession(userId);

    return NextResponse.redirect(new URL("/console", origin));
  } catch (err) {
    console.error("[/api/auth/google/callback] failed:", err);
    return fail("google_failed");
  }
}
