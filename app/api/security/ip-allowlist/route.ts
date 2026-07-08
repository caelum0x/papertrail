import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import { createIpAllowlistSchema } from "@/lib/security/schemas";
import {
  listIpAllowlist,
  addIpAllowlistEntry,
} from "@/lib/security/ipAllowlist";
import type { IpAllowlistEntry } from "@/lib/security/types";

export const runtime = "nodejs";

function rbacStatus(err: unknown): number | null {
  if (
    err instanceof Error &&
    typeof (err as unknown as { status?: unknown }).status === "number"
  ) {
    return (err as unknown as { status: number }).status;
  }
  return null;
}

// GET /api/security/ip-allowlist — paginated list of the org's allowed CIDR
// ranges. Admin+ only.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listIpAllowlist(ctx.org.id, {
      limit,
      offset,
    });
    return ok<IpAllowlistEntry[]>(items, { total, page, limit });
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't load the IP allowlist. Please try again.", 500);
  }
});

// POST /api/security/ip-allowlist — add a CIDR range to the allowlist.
// Admin+ only (settings administration).
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");

    const body = await req.json().catch(() => null);
    const parsed = createIpAllowlistSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid entry.", 400);
    }

    const entry = await addIpAllowlistEntry({
      orgId: ctx.org.id,
      cidr: parsed.data.cidr,
      note: parsed.data.note,
    });

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "ip_allowlist.add",
      entityType: "ip_allowlist",
      entityId: entry.id,
      metadata: { cidr: entry.cidr },
    });

    return created(entry);
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't add the allowlist entry. Please try again.", 500);
  }
});
