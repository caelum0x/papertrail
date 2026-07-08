import { NextRequest } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { ok, fail } from "@/lib/api/response";

export const runtime = "nodejs";

const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

export async function POST(req: NextRequest): Promise<Response> {
  try {
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
