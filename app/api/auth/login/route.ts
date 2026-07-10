import { NextRequest } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

// Throttle brute-force / credential-stuffing: max 5 attempts per IP per 15 minutes.
const LOGIN_RATE_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 };

const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const ip = req.headers.get("x-forwarded-for") ?? "unknown";
    const rate = checkRateLimit(`login:${ip}`, LOGIN_RATE_LIMIT);
    if (!rate.allowed) {
      return fail("Too many login attempts. Please try again later.", 429);
    }

    const json = await req.json().catch(() => null);
    const parsed = loginSchema.safeParse(json);
    if (!parsed.success) {
      return fail("Invalid login input.", 400);
    }
    const normalizedEmail = parsed.data.email.toLowerCase();

    const { rows } = await getPool().query(
      `select id, email, name, password_hash from users where email = $1`,
      [normalizedEmail]
    );
    if (rows.length === 0) {
      return fail("Invalid email or password.", 401);
    }
    const user = rows[0];
    const valid = await verifyPassword(parsed.data.password, user.password_hash);
    if (!valid) {
      return fail("Invalid email or password.", 401);
    }

    await createSession(user.id);
    return ok({
      user: { id: user.id, email: user.email, name: user.name ?? null },
    });
  } catch {
    return fail("Login failed.", 500);
  }
}
