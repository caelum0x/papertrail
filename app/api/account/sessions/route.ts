import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { listSessions, touchSession } from "@/lib/account/repository";
import type { UserSession } from "@/lib/account/types";

export const runtime = "nodejs";

function statusOf(err: unknown): number | null {
  if (err instanceof Error && "status" in err) {
    return (err as { status: number }).status;
  }
  return null;
}

// Best-effort client IP from common proxy headers (Vercel sets x-forwarded-for).
function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip");
}

// GET /api/account/sessions — the current user's active login sessions in the
// active org. Touching the current device first guarantees it appears (and is
// flagged `current`) so the security page always has at least one row to show.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");

    const userAgent = req.headers.get("user-agent");
    const ip = clientIp(req);
    const currentId = await touchSession(ctx.org.id, ctx.user.id, userAgent, ip);

    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listSessions(
      ctx.org.id,
      ctx.user.id,
      currentId,
      limit,
      offset
    );
    return ok<UserSession[]>(items, { total, page, limit });
  } catch (err) {
    const s = statusOf(err);
    return fail(s ? "Forbidden." : "Couldn't load your sessions. Please try again.", s ?? 500);
  }
});
