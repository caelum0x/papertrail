import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getPool } from "@/lib/db";
import { createTokenSchema } from "@/lib/account/schemas";
import { createToken, listTokens } from "@/lib/account/repository";
import { generateToken } from "@/lib/account/token";
import type { PersonalToken } from "@/lib/account/types";

export const runtime = "nodejs";

function statusOf(err: unknown): number | null {
  if (err instanceof Error && "status" in err) {
    return (err as { status: number }).status;
  }
  return null;
}

// GET /api/account/tokens — the current user's own personal access tokens in the
// active org, newest-first. Secrets are never returned here.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listTokens(ctx.org.id, ctx.user.id, limit, offset);
    return ok<PersonalToken[]>(items, { total, page, limit });
  } catch (err) {
    const s = statusOf(err);
    return fail(s ? "Forbidden." : "Couldn't load your tokens. Please try again.", s ?? 500);
  }
});

// POST /api/account/tokens — mint a new personal access token. The plaintext
// secret is generated server-side, hashed for storage, and returned exactly once
// in the create response (never persisted, never logged).
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const json = await req.json().catch(() => null);
    const parsed = createTokenSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const { plaintext, hash } = generateToken();
    const record = await createToken(ctx.org.id, ctx.user.id, parsed.data.name, hash);

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "account.token.create",
      entityType: "personal_token",
      entityId: record.id,
      metadata: { name: record.name },
    });

    // Return the one-time plaintext alongside the record.
    return created<PersonalToken>({ ...record, token: plaintext });
  } catch (err) {
    const s = statusOf(err);
    return fail(s ? "Forbidden." : "Couldn't create the token. Please try again.", s ?? 500);
  }
});
