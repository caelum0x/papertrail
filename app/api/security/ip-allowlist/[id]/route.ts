import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import {
  getIpAllowlistEntry,
  deleteIpAllowlistEntry,
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

// GET /api/security/ip-allowlist/[id] — a single allowlist entry, org-scoped.
export const GET = withOrg(
  async (_req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "admin");
      const id = params?.id;
      if (!id) {
        return fail("Missing allowlist entry id.", 400);
      }
      const entry = await getIpAllowlistEntry(ctx.org.id, id);
      if (!entry) {
        return fail("Allowlist entry not found.", 404);
      }
      return ok<IpAllowlistEntry>(entry);
    } catch (err: unknown) {
      const status = rbacStatus(err);
      if (status !== null) {
        return fail((err as Error).message, status);
      }
      return fail("Couldn't load the allowlist entry. Please try again.", 500);
    }
  }
);

// DELETE /api/security/ip-allowlist/[id] — remove a CIDR range. Admin+ only.
export const DELETE = withOrg(
  async (_req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "admin");
      const id = params?.id;
      if (!id) {
        return fail("Missing allowlist entry id.", 400);
      }

      const deleted = await deleteIpAllowlistEntry(ctx.org.id, id);
      if (!deleted) {
        return fail("Allowlist entry not found.", 404);
      }

      await writeAudit(getPool(), {
        orgId: ctx.org.id,
        userId: ctx.user.id,
        action: "ip_allowlist.delete",
        entityType: "ip_allowlist",
        entityId: id,
      });

      return ok<{ deleted: boolean }>({ deleted: true });
    } catch (err: unknown) {
      const status = rbacStatus(err);
      if (status !== null) {
        return fail((err as Error).message, status);
      }
      return fail("Couldn't delete the allowlist entry. Please try again.", 500);
    }
  }
);
