import { NextRequest } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { created, fail } from "@/lib/api/response";
import { writeAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

// Throttle spam/enumeration/resource exhaustion: max 3 registrations per IP per hour.
const REGISTER_RATE_LIMIT = { max: 3, windowMs: 60 * 60 * 1000 };

const registerSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(200),
  orgName: z.string().min(1).max(200),
});

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 8);
  return base ? `${base}-${suffix}` : `org-${suffix}`;
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const ip = req.headers.get("x-forwarded-for") ?? "unknown";
    const rate = checkRateLimit(`register:${ip}`, REGISTER_RATE_LIMIT);
    if (!rate.allowed) {
      return fail("Too many registration attempts. Please try again later.", 429);
    }

    const json = await req.json().catch(() => null);
    const parsed = registerSchema.safeParse(json);
    if (!parsed.success) {
      return fail("Invalid registration input.", 400);
    }
    const { email, password, name, orgName } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    const pool = getPool();
    const existing = await pool.query(`select id from users where email = $1`, [
      normalizedEmail,
    ]);
    if (existing.rows.length > 0) {
      return fail("An account with that email already exists.", 409);
    }

    const passwordHash = await hashPassword(password);
    const client = await pool.connect();
    try {
      await client.query("begin");
      const userRes = await client.query(
        `insert into users (email, name, password_hash)
         values ($1, $2, $3) returning id, email, name`,
        [normalizedEmail, name, passwordHash]
      );
      const user = userRes.rows[0];

      const orgRes = await client.query(
        `insert into orgs (name, slug) values ($1, $2) returning id, name, slug`,
        [orgName, slugify(orgName)]
      );
      const org = orgRes.rows[0];

      await client.query(
        `insert into memberships (org_id, user_id, role) values ($1, $2, 'owner')`,
        [org.id, user.id]
      );
      await client.query("commit");

      await createSession(user.id);
      await writeAudit(pool, {
        orgId: org.id,
        userId: user.id,
        action: "org.created",
        entityType: "org",
        entityId: org.id,
        metadata: { via: "register" },
      });

      return created({
        user: { id: user.id, email: user.email, name: user.name ?? null },
        org: { id: org.id, name: org.name, slug: org.slug },
      });
    } catch (txErr) {
      await client.query("rollback").catch(() => undefined);
      throw txErr;
    } finally {
      client.release();
    }
  } catch {
    return fail("Registration failed.", 500);
  }
}
